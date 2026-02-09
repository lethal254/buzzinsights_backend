import { Router } from 'express';
import { ResponseUtils } from '../utils/response.utils';
import prisma from '../utils/prismaClient';
import { z } from 'zod';

const router = Router();

// Zod schemas
const preferencesSchema = z.object({
  userId: z.string().optional(),
  orgId: z.string().optional(),
  orgRole: z.string().optional(),
  ingestionSchedule: z.string().optional(),
  ingestionActive: z.boolean().default(false),
  triggerCategorization: z.boolean().default(false),
  emails: z.array(z.string().email('Invalid email format')).default([]),
  issueThreshold: z.number().int().min(0).default(0),
  timeWindow: z.number().int().min(1).max(168).default(24), // max 1 week in hours
  enabled: z.boolean().default(true),
  volumeThresholdMultiplier: z.number().min(1).default(1.5),
  sentimentThreshold: z.number().min(-1).max(1).default(0),
  commentGrowthThreshold: z.number().min(1).default(2.0)
}).refine(data => data.userId || data.orgId, {
  message: "Either userId or orgId must be provided"
});

// Get preferences for a user/org
router.get('/', async (req, res) => {
  try {
    const querySchema = z.object({
      userId: z.string().optional(),
      orgId: z.string().optional()
    }).refine(data => data.userId || data.orgId, {
      message: "Either userId or orgId must be provided"
    });

    const result = querySchema.safeParse({
      userId: req.query.userId,
      orgId: req.query.orgId
    });

    if (!result.success) {
      return ResponseUtils.error(
        res,
        result.error.errors[0].message,
        400,
        'VALIDATION_ERROR'
      );
    }

    const { userId, orgId } = result.data;
    const isOrg = Boolean(orgId);

   if(!userId && !orgId) {
      return ResponseUtils.error(
        res,
        'Either userId or orgId must be provided',
        400,
        'VALIDATION_ERROR'
      );
    }

    const where = isOrg ? { orgId } : { userId };


    let preferences = await prisma.preferences.findFirst({
      where
    });

    // If no preferences exist, return defaults
    if (!preferences) {
      const defaultPreferences = {
        userId: userId || null,
        orgId: orgId || null,
        ingestionSchedule: null,
        ingestionActive: false,
        triggerCategorization: false,
        emails: [],
        issueThreshold: 0,
        timeWindow: 24,
        enabled: true,
        volumeThresholdMultiplier: 1.5,
        sentimentThreshold: 0,
        commentGrowthThreshold: 2.0
      };
      ResponseUtils.success(res, defaultPreferences);
      return;
    }

    ResponseUtils.success(res, preferences);
  } catch (error) {
    ResponseUtils.error(
      res,
      'Failed to fetch preferences',
      500,
      'INTERNAL_SERVER_ERROR',
      error instanceof Error ? error.message : undefined
    );
  }
});

// Update preferences
router.put('/', async (req, res) => {
  try {
    const result = preferencesSchema.safeParse(req.body);
    
    if (!result.success) {
      return ResponseUtils.error(
        res,
        result.error.errors[0].message,
        400,
        'VALIDATION_ERROR'
      );
    }

    const { userId, orgId, orgRole, ...data } = result.data;
    if(!orgId && !userId) {
      return ResponseUtils.error(
        res,
        'Either userId or orgId must be provided',
        400,
        'VALIDATION_ERROR'
      );
    }
    const isOrg = Boolean(orgId);

    console.log(isOrg, orgRole)

    if(isOrg && orgRole !=='org:admin') {
      return ResponseUtils.error(
        res,
        'Only org:admin can update preferences for an organization',
        403,
        'FORBIDDEN'
      );
    }
    
    // Use the appropriate unique identifier
    const where = isOrg ? { orgId } : { userId };

    const preferences = await prisma.preferences.upsert({
      where,
      update: {
        ...data,
        ...(!isOrg ? { userId } : {}),
        ...(isOrg ? { orgId } : {})
      },
      create: {
        ...data,
        ...(!isOrg ? { userId } : {}),
        ...(isOrg ? { orgId } : {})
      },
    });

    ResponseUtils.success(res, preferences);
  } catch (error) {
    ResponseUtils.error(
      res,
      'Failed to update preferences',
      500,
      'INTERNAL_SERVER_ERROR',
      error instanceof Error ? error.message : undefined
    );
  }
});

export default router;
