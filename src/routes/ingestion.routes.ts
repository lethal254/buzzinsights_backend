import { Router } from "express"
import { z } from "zod"
import prisma from "../utils/prismaClient"
import { startIngestion, ingestionQueue } from "../queues/ingestion.queue"
import { ResponseUtils } from "../utils/response.utils"
import { SubReddit } from "@prisma/client"

const router = Router()

// Validation schemas
const SubredditSchema = z.object({
  id: z.number(),
  name: z.string(),
  keywords: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
})

const StartIngestionSchema = z.object({
  userId: z.string().optional(),
  orgId: z.string().optional(),
  orgRole: z.string().optional(),
  subReddits: z.array(SubredditSchema),
  ingestionSchedule: z.string(),
})

const StopIngestionSchema = z.object({
  userId: z.string().optional(),
  orgId: z.string().optional(),
  orgRole: z.string().optional(),
})

const StatusQuerySchema = z.object({
  userId: z.string().optional(),
  orgId: z.string().optional(),
})

/**
 * Start Ingestion
 * POST /start
 */
router.post("/start", async (req, res) => {
  try {
    const result = StartIngestionSchema.safeParse(req.body)

    if (!result.success) {
      return ResponseUtils.error(
        res,
        result.error.errors[0].message,
        400,
        "VALIDATION_ERROR"
      )
    }

    const { userId, orgId, orgRole, subReddits, ingestionSchedule } =
      result.data
    const isOrg = Boolean(orgId)

    if (!userId && !orgId) {
      return ResponseUtils.error(
        res,
        "Authentication error",
        400,
        "VALIDATION_ERROR"
      )
    }

    if (isOrg && orgRole !== "org:admin") {
      return ResponseUtils.error(
        res,
        "Only org:admin can start ingestion for an organization",
        403,
        "FORBIDDEN"
      )
    }

    // Filter out inactive subreddits
    const activeSubreddits = subReddits.filter((sr) => sr.isActive !== false)

    if (activeSubreddits.length === 0) {
      return ResponseUtils.error(
        res,
        "No active subreddits provided",
        400,
        "VALIDATION_ERROR"
      )
    }

    // Create or update Preferences
    await prisma.preferences.upsert({
      where: {
        ...(isOrg ? { orgId } : { userId }),
      },
      update: {
        ingestionSchedule,
        ingestionActive: true,
        updatedAt: new Date(),
      },
      create: {
        ...(isOrg ? { orgId } : { userId }),
        ingestionSchedule,
        ingestionActive: true,
      },
    })

    // Start ingestion with subreddit objects
    await startIngestion({
      userId: userId || null,
      orgId: orgId || null,
      activeSubreddits: activeSubreddits as SubReddit[],
      cronSchedule: ingestionSchedule,
    })

    ResponseUtils.success(res, {
      message: "Ingestion started successfully",
      userId,
      orgId: orgId || null,
      activeSubreddits,
      ingestionSchedule,
    })
  } catch (error) {
    ResponseUtils.error(
      res,
      "Failed to start ingestion",
      500,
      "INGESTION_ERROR",
      error instanceof Error ? error.message : undefined
    )
  }
})

/**
 * Stop Ingestion
 * POST /stop
 */
router.post("/stop", async (req, res) => {
  try {
    const result = StopIngestionSchema.safeParse(req.body)

    if (!result.success) {
      return ResponseUtils.error(
        res,
        result.error.errors[0].message,
        400,
        "VALIDATION_ERROR"
      )
    }

    const { userId, orgId, orgRole } = result.data
    const isOrg = Boolean(orgId)

    if (!userId && !orgId) {
      return ResponseUtils.error(
        res,
        "Authentication error",
        400,
        "VALIDATION_ERROR"
      )
    }

    if (isOrg && orgRole !== "org:admin") {
      return ResponseUtils.error(
        res,
        "Only org:admin can stop ingestion for an organization",
        403,
        "FORBIDDEN"
      )
    }

    // Remove all active jobs
    const activeJobs = await ingestionQueue.getActive()
    const waitingJobs = await ingestionQueue.getWaiting()
    const delayedJobs = await ingestionQueue.getDelayed()

    const allJobs = [...activeJobs, ...waitingJobs, ...delayedJobs]
    let removedCount = 0

    for (const job of allJobs) {
      const jobData = job.data
      if (
        (userId && jobData.userId === userId) ||
        (orgId && jobData.orgId === orgId)
      ) {
        ;(await job.isActive())
          ? await job.moveToFailed({ message: "Ingestion stopped" })
          : await job.remove()
        removedCount++
      }
    }

    // Update preferences
    await prisma.preferences.update({
      where: {
        ...(isOrg ? { orgId } : { userId }),
      },
      data: {
        ingestionActive: false,
        updatedAt: new Date(),
      },
    })

    ResponseUtils.success(res, {
      message: "Ingestion stopped successfully",
      removedJobs: removedCount,
    })
  } catch (error) {
    console.log(error)
    ResponseUtils.error(
      res,
      "Failed to stop ingestion",
      500,
      "INGESTION_ERROR",
      error instanceof Error ? error.message : undefined
    )
  }
})

/**
 * Get Ingestion Status
 * GET /status
 */
router.get("/status", async (req, res) => {
  try {
    const result = StatusQuerySchema.safeParse(req.query)

    if (!result.success) {
      return ResponseUtils.error(
        res,
        result.error.errors[0].message,
        400,
        "VALIDATION_ERROR"
      )
    }

    const { userId, orgId } = result.data
    const isOrg = Boolean(orgId)

    if (!userId && !orgId) {
      return ResponseUtils.error(
        res,
        "Authentication error",
        400,
        "VALIDATION_ERROR"
      )
    }

    const preferences = await prisma.preferences.findUnique({
      where: {
        ...(isOrg ? { orgId } : { userId }),
      },
    })

    if (!preferences) {
      return ResponseUtils.error(
        res,
        "No ingestion configuration found",
        404,
        "NOT_FOUND_ERROR"
      )
    }

    // Get active jobs count
    const activeJobs = await ingestionQueue.getActive()
    const waitingJobs = await ingestionQueue.getWaiting()
    const delayedJobs = await ingestionQueue.getDelayed()

    const allJobs = [...activeJobs, ...waitingJobs, ...delayedJobs]
    const userJobs = allJobs.filter(
      (job) =>
        (userId && job.data.userId === userId) ||
        (orgId && job.data.orgId === orgId)
    )

    ResponseUtils.success(res, {
      isActive: preferences.ingestionActive,
      schedule: preferences.ingestionSchedule,
      activeJobs: userJobs.length,
      lastUpdated: preferences.updatedAt,
    })
  } catch (error) {
    ResponseUtils.error(
      res,
      "Failed to fetch ingestion status",
      500,
      "INGESTION_ERROR",
      error instanceof Error ? error.message : undefined
    )
  }
})

export default router
