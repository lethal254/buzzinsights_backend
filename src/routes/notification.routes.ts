import { Router } from "express"
import prisma from "../utils/prismaClient"
import { ResponseUtils } from "../utils/response.utils"
import { z } from "zod"
import { notificationQueue } from "../queues/notification.queue"

const router = Router()

// Input validation schemas
const notificationSettingsSchema = z
  .object({
    userId: z.string().optional(),
    orgId: z.string().optional(),
    orgRole: z.string().optional(), // We'll receive this but won't save it
    emails: z.array(z.string().email()).default([]), // Allow empty array
    timeWindow: z.number().min(1).max(168).default(24), // 1 hour to 1 week
    issueThreshold: z.number().min(1).default(3),
    volumeThresholdMultiplier: z.number().min(1).default(1.5),
    sentimentThreshold: z.number().min(-1).max(1).default(0),
    commentGrowthThreshold: z.number().min(1).default(2.0),
  })
  .refine((data) => Boolean(data.userId) || Boolean(data.orgId), {
    message: "Either userId or orgId must be provided",
  })

/**
 * Configure Notifications
 * POST /configure
 */
router.post("/configure", async (req, res) => {
  try {
    console.log("Received notification configuration:", req.body)

    const validatedData = notificationSettingsSchema.parse(req.body)
    const { userId, orgId, orgRole, ...settings } = validatedData
    const isOrg = Boolean(orgId)

    if (!userId && !orgId) {
      return ResponseUtils.error(
        res,
        "Either userId or orgId is required",
        400,
        "VALIDATION_ERROR"
      )
    }

    const targetId = orgId || userId
    if (!targetId) {
      return ResponseUtils.error(
        res,
        "Invalid target ID",
        400,
        "VALIDATION_ERROR"
      )
    }

    console.log("Creating/updating preferences for:", {
      isOrg,
      targetId,
      settings,
    })

    try {
      const hasExistingSettings = await prisma.preferences.findFirst({
        where: isOrg ? { orgId: targetId } : { userId: targetId },
      })

      const updatedPreferences = await prisma.preferences.upsert({
        where: isOrg ? { orgId: targetId } : { userId: targetId },
        update: {
          ...settings,
          enabled: settings.emails.length > 0,
          lastNotified: settings.emails.length > 0 ? null : undefined, // Reset only if enabling
        },
        create: {
          ...(isOrg ? { orgId: targetId } : { userId: targetId }),
          ...settings,
          enabled: settings.emails.length > 0,
          lastNotified: null,
          ingestionActive: true,
          ingestionSchedule: null,
          triggerCategorization: false,
        },
      })

      // Handle notification service state
      if (
        settings.emails.length > 0 &&
        (!hasExistingSettings || !hasExistingSettings.enabled)
      ) {
        // Start notification service for this user/org
        await notificationQueue.add(
          { userId: targetId, orgId: isOrg ? targetId : undefined },
          {
            repeat: {
              every: updatedPreferences.timeWindow * 60 * 60 * 1000, // Convert hours to milliseconds
            },
            removeOnComplete: true,
          }
        )
      } else if (settings.emails.length === 0 && hasExistingSettings?.enabled) {
        // Stop notification service for this user/org
        const jobs = await notificationQueue.getJobs(["delayed", "active"])
        const userJobs = jobs.filter((job) => {
          const data = job.data as { userId?: string; orgId?: string }
          return isOrg ? data.orgId === targetId : data.userId === targetId
        })

        await Promise.all(userJobs.map((job) => job.remove()))
      }

      console.log("Preferences updated successfully:", updatedPreferences)

      return ResponseUtils.success(res, {
        message: "Notification preferences updated successfully",
        settings: updatedPreferences,
      })
    } catch (dbError) {
      console.error("Database error:", dbError)
      return ResponseUtils.error(
        res,
        "Database error while updating preferences",
        500,
        "DATABASE_ERROR",
        dbError instanceof Error ? dbError.message : undefined
      )
    }
  } catch (error) {
    console.error("Error in /configure:", error)

    if (error instanceof z.ZodError) {
      return ResponseUtils.error(
        res,
        "Invalid input data",
        400,
        "VALIDATION_ERROR",
        error.errors
      )
    }

    return ResponseUtils.error(
      res,
      "Failed to configure notifications",
      500,
      "NOTIFICATION_ERROR",
      error instanceof Error ? error.message : undefined
    )
  }
})

/**
 * Get Current Notification Settings
 * GET /settings
 */
router.get("/settings", async (req, res) => {
  try {
    const orgId = req.query.orgId as string
    const userId = req.query.userId as string
    const isOrg = Boolean(orgId)

    if (!userId && !orgId) {
      return ResponseUtils.error(
        res,
        "Either userId or orgId is required",
        400,
        "VALIDATION_ERROR"
      )
    }

    const targetId = orgId || userId
    const preferences = await prisma.preferences.findFirst({
      where: isOrg ? { orgId: targetId } : { userId: targetId },
    })

    if (!preferences) {
      return ResponseUtils.error(
        res,
        "No notification settings found",
        404,
        "NOT_FOUND_ERROR"
      )
    }

    ResponseUtils.success(res, preferences)
  } catch (error) {
    ResponseUtils.error(
      res,
      "Failed to fetch notification settings",
      500,
      "NOTIFICATION_ERROR",
      error instanceof Error ? error.message : undefined
    )
  }
})

/**
 * Get Notification History with Details
 * GET /history
 */
router.get("/history", async (req, res) => {
  try {
    const orgId = req.query.orgId as string
    const userId = req.query.userId as string
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50)
    const isOrg = Boolean(orgId)

    if (!userId && !orgId) {
      return ResponseUtils.error(
        res,
        "Either userId or orgId is required",
        400,
        "VALIDATION_ERROR"
      )
    }

    const notifications = await prisma.notificationHistory.findMany({
      where: isOrg ? { orgId } : { userId },
      select: {
        id: true,
        createdAt: true,
        category: true,
        issueCount: true,
        emailsSentTo: true,
        postIds: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit,
    })

    // If you need post details, fetch them separately
    const postIds = notifications.flatMap((n) => n.postIds)
    const posts = await prisma.redditPost.findMany({
      where: {
        id: { in: postIds },
      },
      select: {
        id: true,
        title: true,
        category: true,
        sentimentScore: true,
        numComments: true,
        createdUtc: true,
      },
    })

    // Combine the data
    const notificationsWithPosts = notifications.map((notification) => ({
      ...notification,
      posts: posts.filter((post) => notification.postIds.includes(post.id)),
    }))

    ResponseUtils.success(res, notificationsWithPosts)
  } catch (error) {
    ResponseUtils.error(
      res,
      "Failed to fetch notification history",
      500,
      "NOTIFICATION_ERROR",
      error instanceof Error ? error.message : undefined
    )
  }
})

/**
 * Get Notification Service Status
 * GET /status
 */
router.get("/status", async (req, res) => {
  try {
    const orgId = req.query.orgId as string
    const userId = req.query.userId as string
    const isOrg = Boolean(orgId)
    const targetId = orgId || userId

    if (!targetId) {
      return ResponseUtils.error(
        res,
        "Either userId or orgId is required",
        400,
        "VALIDATION_ERROR"
      )
    }

    // Get user/org preferences
    const preferences = await prisma.preferences.findFirst({
      where: isOrg ? { orgId: targetId } : { userId: targetId },
    })

    if (!preferences) {
      return ResponseUtils.error(
        res,
        "No notification settings found",
        404,
        "NOT_FOUND_ERROR"
      )
    }

    // Get queue status for this user/org
    const jobCounts = await notificationQueue.getJobCounts()
    const repeatable = await notificationQueue.getRepeatableJobs()
    const delayedJobs = await notificationQueue.getJobs(["delayed"])
    const activeJobs = await notificationQueue.getJobs(["active"])
    const lastJob = await notificationQueue.getJobs(["completed"], 0, 1, true)

    // Filter jobs specific to this user/org
    const userDelayedJobs = delayedJobs.filter((job) => {
      const data = job.data as { userId?: string; orgId?: string }
      return isOrg ? data.orgId === targetId : data.userId === targetId
    })

    const userActiveJobs = activeJobs.filter((job) => {
      const data = job.data as { userId?: string; orgId?: string }
      return isOrg ? data.orgId === targetId : data.userId === targetId
    })

    const userNextJob = userDelayedJobs.sort(
      (a, b) => a.timestamp - b.timestamp
    )[0]

    const now = new Date()

    ResponseUtils.success(res, {
      isActive: preferences.enabled && userActiveJobs.length > 0,
      isConfigured: preferences.emails.length > 0 && preferences.timeWindow > 0,
      activeUsers: await prisma.preferences.count({
        where: {
          emails: { isEmpty: false },
          timeWindow: { gt: 0 },
          ...(isOrg ? { orgId: targetId } : { userId: targetId }),
        },
      }),
      lastRun: lastJob?.[0]?.finishedOn || preferences.lastNotified || now,
      nextRun: userNextJob?.timestamp || nextHourDate(now),
      queueStats: {
        waiting: userDelayedJobs.length,
        active: userActiveJobs.length,
        completed: jobCounts.completed,
        failed: jobCounts.failed,
      },
      notifications: {
        pending: userDelayedJobs.map((job) => ({
          id: job.id,
          scheduledFor: new Date(job.timestamp).toISOString(),
          data: job.data,
        })),
      },
    })
  } catch (error) {
    ResponseUtils.error(
      res,
      "Failed to fetch notification service status",
      500,
      "STATUS_ERROR",
      error instanceof Error ? error.message : undefined
    )
  }
})

// Helper function to get next hour
function nextHourDate(date: Date): Date {
  const next = new Date(date)
  next.setHours(next.getHours() + 1)
  next.setMinutes(0)
  next.setSeconds(0)
  next.setMilliseconds(0)
  return next
}

export default router
