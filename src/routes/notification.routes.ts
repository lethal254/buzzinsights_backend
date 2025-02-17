import { Router } from 'express';
import prisma from '../utils/prismaClient';
import { startNotifications, stopNotifications } from '../queues/notification.queue';
import { ResponseUtils } from '../utils/response.utils';

const router = Router();

/**
 * Start Notifications
 * POST /start
 */
router.post("/start", async (req, res) => {
  try {
    const {
      userId,
      orgId,
      orgRole,
      emails,
      timeWindow,
      issueThreshold,
      volumeThresholdMultiplier = 1.5,
      sentimentThreshold = 0,
      commentGrowthThreshold = 2.0,
    } = req.body;

    const isOrg = Boolean(orgId);

    if (!userId && !orgId) {
      return ResponseUtils.error(
        res,
        "Authentication error",
        400,
        'VALIDATION_ERROR'
      );
    }

    if (isOrg && orgRole !== 'org:admin') {
      return ResponseUtils.error(
        res,
        'Only org:admin can configure notifications for an organization',
        403,
        'FORBIDDEN'
      );
    }

    const updatedPreferences = await prisma.preferences.upsert({
      where: isOrg ? { orgId } : { userId },
      update: {
        emails,
        timeWindow: timeWindow || 24,
        issueThreshold: issueThreshold || 3,
        volumeThresholdMultiplier,
        sentimentThreshold,
        commentGrowthThreshold,
        enabled: true
      },
      create: {
        ...(isOrg ? { orgId } : { userId }),
        emails: emails || [],
        timeWindow: timeWindow || 24,
        issueThreshold: issueThreshold || 3,
        volumeThresholdMultiplier,
        sentimentThreshold,
        commentGrowthThreshold,
        enabled: true
      }
    });

    const interval = updatedPreferences.timeWindow * 60 * 60 * 1000; // Convert timeWindow to milliseconds
    await startNotifications(orgId || userId, isOrg, interval);

    ResponseUtils.success(res, {
      message: "Notifications started successfully",
      settings: updatedPreferences
    });
  } catch (error) {
    ResponseUtils.error(
      res,
      "Failed to start notifications",
      500,
      'NOTIFICATION_ERROR',
      error instanceof Error ? error.message : undefined
    );
  }
});

/**
 * Stop Notifications
 * POST /stop
 */
router.post("/stop", async (req, res) => {
  try {
    const { userId, orgId, orgRole } = req.body;
    const isOrg = Boolean(orgId);

    if (!userId && !orgId) {
      return ResponseUtils.error(
        res,
        "Authentication error",
        400,
        'VALIDATION_ERROR'
      );
    }

    if (isOrg && orgRole !== 'org:admin') {
      return ResponseUtils.error(
        res,
        'Only org:admin can stop notifications for an organization',
        403,
        'FORBIDDEN'
      );
    }

    // Get existing preferences
    const preferences = await prisma.preferences.findUnique({
      where: isOrg ? { orgId } : { userId }
    });

    if (!preferences) {
      return ResponseUtils.error(
        res,
        "No notification settings found",
        404,
        'NOT_FOUND_ERROR'
      );
    }

    // Update preferences to disable notifications
    await prisma.preferences.update({
      where: isOrg ? { orgId } : { userId },
      data: {
        enabled: false
      }
    });

    // Stop the notification job
    await stopNotifications(orgId || userId, isOrg);

    ResponseUtils.success(res, {
      message: "Notifications stopped successfully"
    });
  } catch (error) {
    ResponseUtils.error(
      res,
      "Failed to stop notifications",
      500,
      'NOTIFICATION_ERROR',
      error instanceof Error ? error.message : undefined
    );
  }
});

/**
 * Get Notification History
 * GET /history
 */
router.get("/history", async (req, res) => {
  try {
    const orgId = req.query.orgId as string;
    const userId = req.query.userId as string;
    const limit = parseInt(req.query.limit as string) || 10;
    const isOrg = Boolean(orgId);

    if (!userId && !orgId) {
      return ResponseUtils.error(
        res,
        "Authentication error",
        400,
        'VALIDATION_ERROR'
      );
    }

    const notifications = await prisma.notificationHistory.findMany({
      where: isOrg ? { orgId } : { userId },
      orderBy: {
        createdAt: 'desc'
      },
      take: limit
    });

    ResponseUtils.success(res, notifications);
  } catch (error) {
    ResponseUtils.error(
      res,
      "Failed to fetch notification history",
      500,
      'NOTIFICATION_ERROR',
      error instanceof Error ? error.message : undefined
    );
  }
});

export default router;