import { Queue, Worker, JobsOptions, JobType } from "bullmq"
import { redis } from "../config/redis"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { createLogger, transports, format } from "winston"
import prisma from "../utils/prismaClient"
import { ingestData } from "../utils/ingestion.utils"
import { schedulePineconeIngestion } from "../queues/pineconeIngestion.queue"
import { chatModel } from "../utils/aiConfig"

const logger = createLogger({
  level: "info",
  format: format.combine(format.timestamp(), format.json()),
  transports: [
    new transports.Console(),
    new transports.File({ filename: "categorization.log" }),
  ],
})

const model = chatModel

// Create a new BullMQ queue (no default repeat options here)
export const categorizationQueue = new Queue("categorization-queue", {
  connection: redis,
})

// Create a Worker to process jobs from the categorization queue
const categorizationWorker = new Worker(
  "categorization-queue",
  async (job) => {
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

      logger.info(
        `Starting categorization of ${unprocessedPosts.length} posts`,
        {
          targetId,
          isOrg,
          jobId: job.id,
          feedbackCategoriesCount: feedbackCategories.length,
          productCategoriesCount: productCategories.length,
        }
      )

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
    "updateResolvedMention": number,
    "sentimentScore": number,
    "sentimentCategory": string
  }]
}
`
          const result = await model.invoke(prompt)
          const responseText = result.content.toString()

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
      // if (isOrg) {
      //   await schedulePineconeIngestion({ orgId: targetId })
      // } else {
      //   await schedulePineconeIngestion({ userId: targetId })
      // }

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
        jobId: job?.id,
        targetId: job?.data?.targetId,
        isOrg: job?.data?.isOrg,
      })
      throw error
    }
  },
  {
    connection: redis,
    maxStalledCount: 3,
    stalledInterval: 30000,
    lockDuration: 600000, // 10 minutes
    concurrency: 1,
  }
)

// Attach event listeners to the Worker
categorizationWorker.on("completed", (job) => {
  if (!job) return
  logger.info("Categorization job completed", { jobId: job.id })
})

categorizationWorker.on("failed", async (job, err) => {
  if (!job) return

  logger.error("Categorization job failed", {
    jobId: job.id,
    error: err,
    attempts: job.attemptsMade,
  })

  // If max attempts reached, update preferences
  if (job.attemptsMade >= job.opts.attempts!) {
    try {
      const { targetId, isOrg } = job.data
      await prisma.preferences.update({
        where: isOrg ? { orgId: targetId } : { userId: targetId },
        data: { triggerCategorization: false },
      })

      logger.info("Disabled categorization after max retries", {
        targetId,
        isOrg,
        jobId: job.id,
      })
    } catch (error) {
      logger.error("Failed to update preferences after job failure", {
        error,
        jobId: job.id,
      })
    }
  }
})

interface CategorizationJobData {
  targetId: string
  isOrg: boolean
  startedAt: string
  jobKey?: string
}

/**
 * Generate a unique job key for a target
 */
const getJobKey = (targetId: string, isOrg: boolean): string => {
  return `categorization:${isOrg ? "org" : "user"}:${targetId}`
}

/**
 * Start categorization process for a target user/org
 */
export const startCategorization = async (targetId: string, isOrg: boolean) => {
  const jobKey = getJobKey(targetId, isOrg)

  try {
    // Check if categorization is already running for this target using new method
    const schedulers = await categorizationQueue.getJobSchedulers()
    const existingScheduler = schedulers.find(
      (scheduler) =>
        scheduler.name === "categorization-job" &&
        scheduler.id &&
        scheduler.id.includes(jobKey)
    )

    if (existingScheduler) {
      logger.info("Categorization already running", { targetId, isOrg, jobKey })
      return {
        success: false,
        status: "already_running",
        jobKey,
      }
    }

    // Add new repeatable job with concurrency control
    const jobData: CategorizationJobData = {
      targetId,
      isOrg,
      startedAt: new Date().toISOString(),
      jobKey,
    }

    const jobOptions: JobsOptions = {
      jobId: `${jobKey}:${Date.now()}`,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 60000,
      },
      repeat: {
        every: 10 * 60 * 1000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    }

    const job = await categorizationQueue.add(
      "categorization-job",
      jobData,
      jobOptions
    )

    logger.info("Categorization started", {
      jobId: job.id,
      jobKey,
      targetId,
      isOrg,
    })

    return {
      success: true,
      status: "started",
      jobKey,
      jobId: job.id,
    }
  } catch (error) {
    logger.error("Failed to start categorization", {
      error,
      jobKey,
      targetId,
      isOrg,
    })
    throw new Error(
      `Failed to start categorization: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    )
  }
}

/**
 * Stop categorization process for a target user/org
 */
export const stopCategorization = async (targetId: string, isOrg: boolean) => {
  const jobKey = getJobKey(targetId, isOrg)
  let dbUpdated = false

  try {
    // Start a transaction for database operations
    const dbOperations = prisma.$transaction(async (tx) => {
      // First update preferences to prevent new jobs from starting
      await tx.preferences.updateMany({
        where: isOrg ? { orgId: targetId } : { userId: targetId },
        data: { triggerCategorization: false },
      })

      // Reset processing flags
      await tx.redditPost.updateMany({
        where: {
          ...(isOrg ? { orgId: targetId } : { userId: targetId }),
          needsProcessing: true,
        },
        data: {
          processingPriority: 0,
          needsProcessing: true,
        },
      })
      return true
    })

    // Get all repeatable jobs
    const repeatableJobs = await categorizationQueue.getRepeatableJobs()
    const targetRepeatableJobs = repeatableJobs.filter(
      (job) => job.id && job.id.includes(jobKey)
    )

    // Track removal results
    const results = {
      repeatableRemoved: 0,
      activeJobsStopped: 0,
      failedRemovals: 0,
      errors: [] as string[],
    }

    // Remove repeatable jobs
    for (const job of targetRepeatableJobs) {
      try {
        if (job.key) {
          await categorizationQueue.removeRepeatableByKey(job.key)
          results.repeatableRemoved++
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error"
        results.errors.push(
          `Failed to remove repeatable job ${job.key}: ${errorMessage}`
        )
        results.failedRemovals++
      }
    }

    // Handle existing jobs in various states
    const states: JobType[] = ["active", "waiting", "delayed"]
    const allJobs = await Promise.all(
      states.map((state) => categorizationQueue.getJobs([state]))
    )

    for (const jobs of allJobs.flat()) {
      const jobData = jobs.data as CategorizationJobData
      if (jobData.jobKey === jobKey) {
        try {
          const state = await jobs.getState()
          if (state === "active") {
            await jobs.moveToFailed(
              new Error("Categorization stopped by user"),
              true
            )
          } else {
            await jobs.remove()
          }
          results.activeJobsStopped++
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error"
          results.errors.push(`Failed to stop job ${jobs.id}: ${errorMessage}`)
          results.failedRemovals++
        }
      }
    }

    // Wait for database transaction to complete
    await dbOperations
    dbUpdated = true

    // Log results
    logger.info("Categorization stopped", {
      jobKey,
      targetId,
      isOrg,
      results,
    })

    if (results.failedRemovals > 0) {
      logger.warn("Some jobs failed to stop", {
        jobKey,
        targetId,
        isOrg,
        errors: results.errors,
      })
    }

    return {
      success: results.failedRemovals === 0,
      results,
      errors: results.errors,
    }
  } catch (error) {
    logger.error("Error stopping categorization", {
      error,
      jobKey,
      targetId,
      isOrg,
      dbUpdated,
    })

    // If database was not updated, throw error to trigger rollback
    if (!dbUpdated) {
      throw new Error(
        `Failed to stop categorization: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      )
    }

    // If database was updated but queue operations failed, return partial success
    return {
      success: false,
      partial: true,
      dbUpdated,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
