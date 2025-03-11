import { Queue, Worker, Job } from "bullmq"
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

// Create the pinecone ingestion queue
export const pineconeQueue = new Queue<IngestionJobData>("pinecone-ingestion", {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: false,
    removeOnFail: false,
  },
})

// Create a Worker to process jobs from the pinecone ingestion queue
const pineconeWorker = new Worker<IngestionJobData>(
  "pinecone-ingestion",
  async (job: Job<IngestionJobData>) => {
    logger.info("Processing pinecone ingestion job", {
      jobId: job.id,
      payload: job.data.payload,
    })
    // Optional delay to see the job active
    await new Promise((resolve) => setTimeout(resolve, 5000))
    const startTime = Date.now()
    try {
      const { orgId, userId } = job.data.payload || {}
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
  },
  { connection: redis }
)

// Attach event listeners for debugging job lifecycle
pineconeWorker.on("active", (job) => {
  console.info(`Job ${job.id} is now active`)
})
pineconeWorker.on("completed", (job, result) => {
  console.info(`Job ${job.id} completed with result:`, result)
})
pineconeWorker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed with error:`, err)
})

// API to schedule a one-off pinecone ingestion job
export const schedulePineconeIngestion = async (payload: {
  orgId?: string
  userId?: string
}) => {
  const uniqueJobId = `pinecone-ingestion-${payload.orgId || "no-org"}-${
    payload.userId || "no-user"
  }`

  // Remove any existing repeatable job with the same unique id, if it exists
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

// API to cancel pinecone ingestion jobs for a specific user/org
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
  const waitingJobs = await pineconeQueue.getJobs(["waiting"])
  for (const job of waitingJobs) {
    if (job.id === uniqueJobId) {
      await job.remove()
      removedCount++
      logger.info("Cancelled waiting pinecone ingestion job", { uniqueJobId })
    }
  }

  // Remove delayed jobs
  const delayedJobs = await pineconeQueue.getJobs(["delayed"])
  for (const job of delayedJobs) {
    if (job.id === uniqueJobId) {
      await job.remove()
      removedCount++
      logger.info("Cancelled delayed pinecone ingestion job", { uniqueJobId })
    }
  }

  // For active jobs, move them to failed
  const activeJobs = await pineconeQueue.getJobs(["active"])
  for (const job of activeJobs) {
    if (job.id === uniqueJobId) {
      await job.moveToFailed(
        new Error("Pinecone ingestion cancelled"),
        "",
        true
      )
      removedCount++
      logger.info("Cancelled active pinecone ingestion job", { uniqueJobId })
    }
  }

  return removedCount
}
