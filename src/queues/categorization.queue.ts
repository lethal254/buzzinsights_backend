import { Queue, Worker, JobsOptions, JobType } from "bullmq"
import { redis } from "../config/redis"
import { createLogger, transports, format } from "winston"
import prisma from "../utils/prismaClient"
import { chatModel } from "../utils/aiConfig"
import { emailQueue } from "./email.queue"
import { formatDistanceToNow } from "date-fns"

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

if (process.env.ENABLE_QUEUE_WORKERS === "true") {
  const categorizationWorker = new Worker(
    "categorization-queue",
    async (job) => {
      try {
        logger.info("Starting categorization job", { jobId: job.id })
        const { targetId, isOrg } = job.data

        // Get categories for the user/org
        const [feedbackCategories, productCategories, buckets] = await Promise.all([
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
          prisma.feedbackBucket.findMany({
            where: isOrg ? { orgId: targetId } : { userId: targetId },
            select: {
              id: true,
              name: true,
              description: true,
              posts: {
                select: {
                  title: true,
                  content: true,
                },
              },
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
            
            Available feedback categories with descriptions:
            ${JSON.stringify(feedbackCategories)}
            
            Available product categories with identifiers and keywords:
            ${JSON.stringify(productCategories)}
            
            Available feedback buckets with descriptions and existing posts:
            ${JSON.stringify(buckets.map(bucket => ({
              id: bucket.id,
              name: bucket.name,
              description: bucket.description,
              examplePosts: bucket.posts.map(post => ({
                title: post.title,
                content: post.content
              }))
            })))}
            
            For each post, provide:
            
            1. Product category analysis:
               - Select from provided categories or use "Uncertain" if confidence is low
               - Use "Noise" ONLY if content is clearly unrelated to any products (spam, off-topic)
               - Include a confidence score (0-1) for your product categorization
               - Map customer terminology to official product names when possible
            
            2. Feedback category analysis:
               - Select the most appropriate feedback category or "Uncertain" if unclear
               - Only use "Noise" when content contains no actionable feedback or product references
               - Include a confidence score (0-1) for your feedback categorization
               - For mixed feedback types, prioritize bugs > feature requests > general feedback
            
            3. Bucket suggestions:
               - For each bucket, analyze ALL example posts within that bucket to understand the common patterns
               - Create a "bucket fingerprint" based on:
                   * Common products/devices mentioned across example posts
                   * Common issue types and symptoms described
                   * Shared terminology and specific keywords that appear frequently
               - Match new posts against these bucket fingerprints rather than single examples
               - First identify exact keyword matches between the new post and the bucket fingerprint
               - Prioritize posts that mention BOTH the same issue AND same product/device as found in the bucket fingerprint
               - Example: If a bucket contains multiple posts about "flicker issues on MacBook Pro 2020", new posts about flickering on that specific device should match strongly
               - Consider partial matches (same issue, different device OR same device, different issue) as lower confidence
               - Only match between different products when the issue description has identical keywords
               - Include a detailed confidence score (0-1) based on:
                   * 0.9-1.0: Exact issue AND exact product/device match with multiple example posts
                   * 0.8-0.89: Exact issue with similar product/device OR perfect match with a single example post
                   * 0.7-0.79: Similar issue with exact product/device
                   * 0.6-0.69: Similar issue with similar product/device
                   * <0.6: Only general topic similarity
               - Only suggest buckets with confidence > 0.7
               - If no buckets meet the threshold, return an empty array
               - For each suggested bucket, provide the matching keywords and reference which example posts were most similar
            
            4. Content analysis metrics:
               - sameIssuesCount: Count users describing functionally identical problems
               - sameDeviceCount: Count mentions of identical hardware/software configurations
               - solutionsCount: Count distinct solution approaches (not just solution mentions)
               - updateIssueMention: Count references to problems after specific update versions
               - updateResolvedMention: Count references to fixes after specific update versions
            
            5. Sentiment analysis:
               - Calculate sentimentScore (0-5) based on emotional tone, not just problem reporting
               - Technical problem reports should not be automatically negative unless tone is frustrated
               - Determine sentimentCategory as "Negative" (0-1.66), "Neutral" (1.67-3.33), or "Positive" (3.34-5)
               - Consider cultural variations in how feedback is expressed
            
            IMPORTANT GUIDELINES:
            - Express uncertainty rather than guessing - use "Uncertain" when confidence is low
            - Mark content as "Noise" only when clearly unrelated to products/feedback
            - For posts with missing/incomplete information, analyze based on available text
            - For extremely long posts, prioritize title, first paragraph, and conclusion
            - NEVER hallucinate buckets - only match with the provided bucket examples
            - For bucketing:
                * Learn patterns from ALL example posts within each bucket
                * Create a weighted keyword frequency analysis for each bucket
                * Prioritize specific products, versions, and exact issue descriptions
                * Consider the specificity hierarchy: exact product+issue > same product+similar issue > same issue+different product
                * When matching across different products, require near-identical issue descriptions
            
            Respond with valid JSON only:
            {
              "results": [{
                "id": string,
                "product": string,
                "productConfidence": number,
                "category": string,
                "categoryConfidence": number,
                "bucketSuggestions": [{
                  "bucketId": string,
                  "confidence": number,
                  "matchReason": string,  // Brief explanation of main matching factors
                  "matchingExamplePosts": [string],  // IDs or indexes of the most similar example posts in the bucket
                  "matchingKeywords": [string]  // List of specific keywords that matched
                }],
                "sameIssuesCount": number,
                "sameDeviceCount": number,
                "solutionsCount": number,
                "updateIssueMention": number,
                "updateResolvedMention": number,
                "sentimentScore": number,
                "sentimentCategory": string,
                "analysisNotes": string  // Include matched keywords and any uncertainty or special handling
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
                    // Add bucket suggestions with confidence > 0.7
                    buckets: {
                      connect: item.bucketSuggestions
                        .filter((suggestion: { confidence: number }) => suggestion.confidence > 0.6)
                        .map((suggestion: { bucketId: string }) => ({
                          id: suggestion.bucketId,
                        })),
                    },
                    addedToBucketByAI: item.bucketSuggestions.some((suggestion: { confidence: number }) => suggestion.confidence > 0.6),
                  },
                })
              )
            )

            // Get posts that were added to buckets by AI
            const aiAddedPosts = await prisma.redditPost.findMany({
              where: {
                id: { in: batch.map(post => post.id) },
                addedToBucketByAI: true
              },
              select: {
                title: true,
                content: true,
                author: true,
                createdUtc: true,
                permalink: true,
                buckets: {
                  select: {
                    id: true,
                    name: true,
                    description: true
                  }
                }
              }
            })

            // Group posts by bucket for notifications
            const postsByBucket = aiAddedPosts.reduce((acc, post) => {
              post.buckets.forEach(bucket => {
                if (!acc[bucket.id]) {
                  acc[bucket.id] = {
                    bucket,
                    posts: []
                  }
                }
                acc[bucket.id].posts.push(post)
              })
              return acc
            }, {} as Record<string, { bucket: { id: string; name: string; description: string | null }; posts: typeof aiAddedPosts }>)

            // Send notifications for each bucket
            for (const { bucket, posts } of Object.values(postsByBucket)) {
              // Get user preferences for notifications
              const preferences = await prisma.preferences.findFirst({
                where: isOrg ? { orgId: targetId } : { userId: targetId },
                select: {
                  emails: true
                }
              })

              if (preferences?.emails && preferences.emails.length > 0) {
                await sendBucketNotification(
                  {
                    name: bucket.name,
                    description: bucket.description
                  },
                  posts,
                  preferences.emails
                )
              }
            }

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
}

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

// Helper function to send bucket notifications
async function sendBucketNotification(
  bucket: { name: string; description?: string | null },
  posts: { title: string; content: string; author: string; createdUtc: bigint; permalink?: string | null }[],
  emails: string[]
) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #2c3e50; border-bottom: 2px solid #eee; padding-bottom: 10px;">
        New Posts Added to Bucket: ${bucket.name}
      </h1>
      
      <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <h2 style="color: #2c3e50; margin-top: 0;">Bucket Details</h2>
        ${bucket.description ? `<p>${bucket.description}</p>` : ''}
        <p>Posts Added: ${posts.length}</p>
      </div>

      ${posts.map(post => `
        <div style="border: 1px solid #eee; padding: 15px; margin: 10px 0; border-radius: 5px;">
          <h3 style="margin: 0; color: #2c3e50;">${post.title}</h3>
          <p style="color: #666; font-size: 14px;">
            Posted by ${post.author} • ${formatDistanceToNow(new Date(Number(post.createdUtc) * 1000), { addSuffix: true })}
          </p>
          <p style="margin: 10px 0;">${post.content.slice(0, 150)}...</p>
          ${post.permalink ? `
            <a href="https://reddit.com${post.permalink}" 
              style="background: #0066cc; color: white; padding: 5px 10px; text-decoration: none; border-radius: 3px;">
              View Discussion
            </a>
          ` : ''}
        </div>
      `).join('')}
    </div>
  `

  await emailQueue.add('bucket-notification', {
    to: emails,
    subject: `New Posts Added to Bucket: ${bucket.name}`,
    content: html,
    timestamp: new Date()
  })
}
