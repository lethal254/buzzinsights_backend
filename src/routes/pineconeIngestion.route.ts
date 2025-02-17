import { Router } from "express"
import { z } from "zod"
import { ResponseUtils } from "../utils/response.utils"
import {
  cancelPineconeIngestion,
  schedulePineconeIngestion,
} from "../queues/pineconeIngestion.queue"
import { ingestData } from "../utils/ingestion.utils"

const router = Router()

const StartPineconeIngestionSchema = z.object({
  userId: z.string().optional(),
  orgId: z.string().optional(),
})
const StopPineconeIngestionSchema = z.object({
  userId: z.string().optional(),
  orgId: z.string().optional(),
})

/**
 * Start Ingestion
 * GET /start
 */
router.get("/start", async (req, res) => {
  try {
    const result = StartPineconeIngestionSchema.safeParse(req.query)
    if (!result.success) {
      return ResponseUtils.error(
        res,
        result.error.errors[0].message,
        400,
        "VALIDATION_ERROR"
      )
    }

    const { userId, orgId } = result.data
    if (!userId && !orgId) {
      return ResponseUtils.error(
        res,
        "Missing user or organization identifier",
        400,
        "VALIDATION_ERROR"
      )
    }

    const isOrg = Boolean(orgId)

    if (isOrg) {
      await ingestData({ orgId })
    } else {
      await ingestData({ userId })
    }

    // Trigger scheduling only via API.

    ResponseUtils.success(res, "Ingestion Started via API")
  } catch (error) {
    ResponseUtils.error(
      res,
      "Failed to start Ingestion ",
      500,
      "Pinecone ingestion error",
      error instanceof Error ? error.message : undefined
    )
  }
})

/**
 * Stop Ingestion
 * GET /stop
 */
router.get("/stop", async (req, res) => {
  try {
    const result = StopPineconeIngestionSchema.safeParse(req.query)
    if (!result.success) {
      return ResponseUtils.error(
        res,
        result.error.errors[0].message,
        400,
        "VALIDATION_ERROR"
      )
    }

    const { userId, orgId } = result.data
    if (!userId && !orgId) {
      return ResponseUtils.error(
        res,
        "Authentication error",
        400,
        "VALIDATION_ERROR"
      )
    }

    // Pass the same payload used to schedule the task so the correct queue is found.
    if (orgId) {
      await cancelPineconeIngestion({ userId, orgId })
    } else if (userId) {
      await cancelPineconeIngestion({ userId, orgId })
    }

    ResponseUtils.success(res, "Ingestion Stopped")
  } catch (error) {
    ResponseUtils.error(
      res,
      "Failed to stop Ingestion ",
      500,
      "Pinecone ingestion error",
      error instanceof Error ? error.message : undefined
    )
  }
})

export default router
