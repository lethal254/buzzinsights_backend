import Queue, { Job } from "bull"
import { redis } from "../config/redis"
import { createLogger, transports, format } from "winston"
import { ingestData } from "../utils/ingestion.utils"

interface IngestionJobData {
  type: "pineconeIngestion"
  payload?: {
    orgId?: string
    userId?: string
  }
}

const logger = createLogger({
  level: "info",
  format: format.combine(format.timestamp(), format.json()),
  transports: [
    new transports.Console(),
    new transports.File({ filename: "pinecone-ingestion-queue.log" }),
  ],
})

// Create a fixed queue instance
export const pineconeQueue = new Queue<IngestionJobData>("pinecone-ingestion", {
  redis: redis,
  defaultJobOptions: {
    removeOnComplete: false,
    removeOnFail: false,
  },
})

// Add event listeners for debugging job lifecycle
pineconeQueue.on("active", (job) => {
  console.info(`Job ${job.id} is now active`)
})
pineconeQueue.on("completed", (job, result) => {
  console.info(`Job ${job.id} completed with result:`, result)
})
pineconeQueue.on("failed", (job, err) => {
  console.error(`Job ${job.id} failed with error:`, err)
})

// Update the processor to register a named handler for "pinecone-ingestion"
pineconeQueue.process(
  "pinecone-ingestion",
  async (job: Job<IngestionJobData>) => {
    logger.info("Processing pinecone ingestion job", {
      jobId: job.id,
      payload: job.data.payload,
    })
    // Optionally add a small delay to see the job active
    await new Promise((resolve) => setTimeout(resolve, 5000))
    const startTime = Date.now()
    try {
      const { orgId, userId } = job.data.payload || {}

      // Added logging before calling ingestData
      logger.info("Calling ingestData", { orgId, userId })
      await ingestData({
        orgId: orgId || undefined,
        userId: userId || undefined,
      })
      logger.info("ingestData completed", {
        jobId: job.id,
        duration: `${Date.now() - startTime}ms`,
      })
    } catch (error) {
      logger.error("Error in pinecone ingestion job", { jobId: job.id, error })
      throw error
    }
  }
)

// API to schedule a one-off pinecone ingestion job
export const schedulePineconeIngestion = async (payload: {
  orgId?: string
  userId?: string
}) => {
  const uniqueJobId = `pinecone-ingestion-${payload.orgId || "no-org"}-${
    payload.userId || "no-user"
  }`

  // Remove any existing job with the same unique id (if applicable)
  const existingJobs = await pineconeQueue.getRepeatableJobs()
  for (const job of existingJobs) {
    if (job.id === uniqueJobId) {
      await pineconeQueue.removeRepeatableByKey(job.key)
      logger.info("Removed existing repeatable pinecone ingestion job", {
        uniqueJobId,
      })
    }
  }

  // Add a one-off job without the 'repeat' option
  await pineconeQueue.add(
    "pinecone-ingestion",
    { type: "pineconeIngestion", payload },
    { jobId: uniqueJobId }
  )
  logger.info("Scheduled one-off pinecone ingestion", { payload, uniqueJobId })
}

// Updated API to cancel pinecone ingestion job for a specific user/org
export const cancelPineconeIngestion = async (payload: {
  orgId?: string
  userId?: string
}) => {
  const uniqueJobId = `pinecone-ingestion-${payload.orgId || "no-org"}-${
    payload.userId || "no-user"
  }`
  let removedCount = 0

  // Remove repeatable jobs
  const repeatableJobs = await pineconeQueue.getRepeatableJobs()
  for (const job of repeatableJobs) {
    if (job.id === uniqueJobId) {
      await pineconeQueue.removeRepeatableByKey(job.key)
      removedCount++
      logger.info("Cancelled repeatable pinecone ingestion job", {
        uniqueJobId,
      })
    }
  }

  // Remove waiting jobs
  const waitingJobs = await pineconeQueue.getWaiting()
  for (const job of waitingJobs) {
    if (job.id === uniqueJobId) {
      await job.remove()
      removedCount++
      logger.info("Cancelled waiting pinecone ingestion job", { uniqueJobId })
    }
  }

  // Move active jobs to failed
  const activeJobs = await pineconeQueue.getActive()
  for (const job of activeJobs) {
    if (job.id === uniqueJobId) {
      await job.moveToFailed({ message: "Pinecone ingestion cancelled" }, true)
      removedCount++
      logger.info("Cancelled active pinecone ingestion job", { uniqueJobId })
    }
  }

  return removedCount
}
