import { Router } from "express"
import prisma from "../utils/prismaClient"
import {
  enableNotifications,
  disableNotifications,
} from "../queues/notification.queue"
import { ResponseUtils } from "../utils/response.utils"
import { z } from "zod" // Add input validation

const router = Router()

// Input validation schemas
const notificationSettingsSchema = z
  .object({
    userId: z.string().optional(),
    orgId: z.string().optional(),
    orgRole: z.string().optional(),
    emails: z.array(z.string().email()).min(1),
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

    const updatedPreferences = await prisma.preferences.upsert({
      where: isOrg ? { orgId: targetId } : { userId: targetId },
      update: {
        ...settings,
        enabled: true,
        ingestionActive: true,
      },
      create: {
        ...(isOrg ? { orgId: targetId } : { userId: targetId }),
        ...settings,
        enabled: true,
        ingestionActive: true,
      },
    })

    // Enable notifications with new settings
    await enableNotifications(targetId, isOrg)

    ResponseUtils.success(res, {
      message: "Notification preferences updated successfully",
      settings: updatedPreferences,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return ResponseUtils.error(
        res,
        "Invalid input data",
        400,
        "VALIDATION_ERROR",
        error.errors
      )
    }
    ResponseUtils.error(
      res,
      "Failed to configure notifications",
      500,
      "NOTIFICATION_ERROR",
      error instanceof Error ? error.message : undefined
    )
  }
})

/**
 * Toggle Notifications
 * POST /toggle
 */
router.post("/toggle", async (req, res) => {
  try {
    const { userId, orgId, orgRole, enable } = req.body
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

    const preferences = await prisma.preferences.findUnique({
      where: isOrg ? { orgId: targetId } : { userId: targetId },
    })

    if (!preferences) {
      return ResponseUtils.error(
        res,
        "Please configure notifications first",
        404,
        "NOT_FOUND_ERROR"
      )
    }

    if (enable) {
      await enableNotifications(targetId, isOrg)
    } else {
      await disableNotifications(targetId, isOrg)
    }

    await prisma.preferences.update({
      where: isOrg ? { orgId: targetId } : { userId: targetId },
      data: {
        enabled: enable,
        ingestionActive: enable,
      },
    })

    ResponseUtils.success(res, {
      message: `Notifications ${enable ? "enabled" : "disabled"} successfully`,
    })
  } catch (error) {
    ResponseUtils.error(
      res,
      "Failed to toggle notifications",
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

export default router
