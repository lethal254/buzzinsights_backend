import Queue from "bull"
import { REDIS_CONFIG } from "../config/redis"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { createLogger, transports, format } from "winston"
import prisma from "../utils/prismaClient"
import { ingestData } from "../utils/ingestion.utils"
import { schedulePineconeIngestion } from "../queues/pineconeIngestion.queue"

const logger = createLogger({
  level: "info",
  format: format.combine(format.timestamp(), format.json()),
  transports: [
    new transports.Console(),
    new transports.File({ filename: "categorization.log" }),
  ],
})

const geminiAPIKey = process.env.GEMINI_API_KEY as string
const genAI = new GoogleGenerativeAI(geminiAPIKey)
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

// Create a new queue
export const categorizationQueue = new Queue("categorization-queue", {
  redis: REDIS_CONFIG,
  defaultJobOptions: {
    repeat: {
      every: 60 * 60 * 1000, // 1 hour
    },
  },
})

// Process jobs
categorizationQueue.process(async (job) => {
  try {
    logger.info("Starting categorization job", { jobId: job.id })
    const { targetId, isOrg } = job.data

    // Get categories for the user/org
    const [feedbackCategories, productCategories] = await Promise.all([
      prisma.feedbackCategory.findMany({
        where: isOrg ? { orgId: targetId } : { userId: targetId },
        select: {
          name: true,
          description: true,
          keywords: true,
        },
      }),
      prisma.productCategory.findMany({
        where: isOrg ? { orgId: targetId } : { userId: targetId },
        select: {
          id: true,
          name: true,
          keywords: true,
          versions: true,
        },
      }),
    ])

    // Check if categories are defined
    if (feedbackCategories.length === 0 && productCategories.length === 0) {
      logger.warn("No categories defined", {
        targetId,
        isOrg,
        jobId: job.id,
      })
      // Mark all feedback as noise since no categories are defined
      const updatedCount = await prisma.redditPost.updateMany({
        where: {
          ...(isOrg ? { orgId: targetId } : { userId: targetId }),
          needsProcessing: true,
        },
        data: {
          category: "Noise",
          product: "Noise",
          needsProcessing: false,
        },
      })
      logger.info(
        `Marked ${updatedCount.count} posts as noise due to no categories defined`
      )
      return {
        success: true,
        status: "no_categories",
        message: "No categories defined, all feedback marked as noise",
      }
    }

    // Get unprocessed Reddit posts
    const unprocessedPosts = await prisma.redditPost.findMany({
      where: {
        ...(isOrg ? { orgId: targetId } : { userId: targetId }),
        needsProcessing: true,
      },
      include: {
        comments: true,
      },
      orderBy: [{ processingPriority: "asc" }, { createdUtc: "asc" }],
    })

    if (unprocessedPosts.length === 0) {
      logger.info("No unprocessed posts found", {
        targetId,
        isOrg,
        jobId: job.id,
      })
      return {
        success: true,
        status: "no_posts",
        message: "No unprocessed posts found",
      }
    }

    logger.info(`Starting categorization of ${unprocessedPosts.length} posts`, {
      targetId,
      isOrg,
      jobId: job.id,
      feedbackCategoriesCount: feedbackCategories.length,
      productCategoriesCount: productCategories.length,
    })

    // Process posts in batches
    const BATCH_SIZE = 10
    let processedCount = 0
    let errorCount = 0

    for (let i = 0; i < unprocessedPosts.length; i += BATCH_SIZE) {
      const batch = unprocessedPosts.slice(i, i + BATCH_SIZE)

      try {
        const prompt = `
Analyze the following Reddit posts and their comments:
${JSON.stringify(
  batch.map((post) => ({
    id: post.id,
    title: post.title,
    content: post.content,
    comments: post.comments.map((c) => c.content),
  }))
)}

Available feedback categories:
${JSON.stringify(feedbackCategories)}

Available product categories:
${JSON.stringify(productCategories)}

For each post, provide:
1. Product category (from the provided list, or "Noise" if none apply)
   - Use product identifiers and versions to accurately match products
   - Consider both exact matches and variations
   - If no product categories are available or none match, use "Noise"
2. Feedback category (from the provided list, or "Noise" if none apply)
   - Use category keywords to determine the best match
   - Mark as "Noise" if no categories match or if post is not feedback-related
3. Analyze and count:
   - Number of users mentioning the same issue (sameIssuesCount)
   - Number of users mentioning the same device (sameDeviceCount)
   - Number of users providing solutions (solutionsCount)
   - Number of mentions about issues after updates (updateIssueMention)
   - Number of mentions about resolutions after updates (updateResolvedMention)
   - Determine the sentiment score on a scale from 0 (very negative) to 5 (very positive) based on the combined text (title, content, and comments).
   - Determine the sentiment category (Negative, Positive or Neutral) based on the combined text (title, content, and comments).

IMPORTANT: Respond with raw JSON only, no markdown formatting. The response should be a valid JSON object with this exact structure:
{
  "results": [{
    "id": string,
    "product": string,
    "category": string,
    "sameIssuesCount": number,
    "sameDeviceCount": number,
    "solutionsCount": number,
    "updateIssueMention": number,
    "updateResolvedMention": number
    "sentimentScore": number,
    "sentimentCategory": string
  }]
}
`

        const result = await model.generateContent(prompt)
        const responseText = result.response.text()

        // Clean up markdown formatting if present and parse JSON
        const jsonStr = responseText.replace(/```json\n|\n```/g, "").trim()
        const analysis = JSON.parse(jsonStr)

        // Update Reddit posts with categorization results
        await prisma.$transaction(
          analysis.results.map((item: any) =>
            prisma.redditPost.update({
              where: { id: item.id },
              data: {
                product: item.product,
                category: item.category,
                sameIssuesCount: item.sameIssuesCount,
                sameDeviceCount: item.sameDeviceCount,
                solutionsCount: item.solutionsCount,
                updateIssueMention: item.updateIssueMention,
                updateResolvedMention: item.updateResolvedMention,
                needsProcessing: false,
                sentimentScore: item.sentimentScore,
                sentimentCategory: item.sentimentCategory,
              },
            })
          )
        )

        processedCount += batch.length
        logger.info(`Processed batch of ${batch.length} posts`, {
          jobId: job.id,
          processedCount,
          totalPosts: unprocessedPosts.length,
        })
      } catch (error) {
        errorCount++
        logger.error("Error processing batch", {
          error,
          jobId: job.id,
          batchStart: i,
          batchSize: batch.length,
        })

        // Mark failed batch as needing reprocessing
        await prisma.redditPost.updateMany({
          where: {
            id: { in: batch.map((post) => post.id) },
          },
          data: {
            processingPriority: {
              increment: 1,
            },
          },
        })

        // If too many errors, stop processing
        if (errorCount >= 3) {
          throw new Error(
            `Too many batch processing errors (${errorCount}), stopping job`
          )
        }
      }

      // Rate limiting between batches
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }

    logger.info("Categorization job completed", {
      jobId: job.id,
      processedCount,
      errorCount,
      totalPosts: unprocessedPosts.length,
    })

    // When categorization ends, schedule ingestion via the queue
    if (isOrg) {
      await schedulePineconeIngestion({ orgId: targetId })
    } else {
      await schedulePineconeIngestion({ userId: targetId })
    }

    return {
      success: true,
      status: "completed",
      stats: {
        processedCount,
        errorCount,
        totalPosts: unprocessedPosts.length,
      },
    }
  } catch (error) {
    logger.error("Categorization job failed", {
      error,
      jobId: job.id,
      targetId: job.data.targetId,
      isOrg: job.data.isOrg,
    })
    throw error
  }
})

// Queue events
categorizationQueue.on("completed", (job) => {
  logger.info("Categorization job completed", { jobId: job.id })
})

categorizationQueue.on("failed", (job, error) => {
  logger.error("Categorization job failed", { jobId: job.id, error })
})

// Add a job to the queue
export const startCategorization = async (targetId: string, isOrg: boolean) => {
  await categorizationQueue.add(
    { targetId, isOrg },
    {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 60000, // 1 minute
      },
    }
  )
}

// Stop categorization for a specific target
export const stopCategorization = async (targetId: string, isOrg: boolean) => {
  try {
    // Get all active jobs
    const activeJobs = await categorizationQueue.getActive()
    const waitingJobs = await categorizationQueue.getWaiting()
    const delayedJobs = await categorizationQueue.getDelayed()

    const allJobs = [...activeJobs, ...waitingJobs, ...delayedJobs]

    // Find and remove jobs for the specific target
    let removedCount = 0
    for (const job of allJobs) {
      if (job.data.targetId === targetId && job.data.isOrg === isOrg) {
        ;(await job.isActive())
          ? await job.moveToFailed({ message: "Categorization stopped" })
          : await job.remove()
        removedCount++
      }
    }

    // Reset processing status for any posts that were mid-processing
    await prisma.redditPost.updateMany({
      where: {
        ...(isOrg ? { orgId: targetId } : { userId: targetId }),
        needsProcessing: true,
      },
      data: {
        processingPriority: 0, // Reset priority
      },
    })

    logger.info("Categorization stopped", {
      targetId,
      isOrg,
      removedJobs: removedCount,
    })

    return {
      success: true,
      removedJobs: removedCount,
    }
  } catch (error) {
    logger.error("Error stopping categorization", {
      error,
      targetId,
      isOrg,
    })
    throw error
  }
}
