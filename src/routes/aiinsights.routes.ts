import { Router } from "express"
import { z } from "zod"
import { ResponseUtils } from "../utils/response.utils"
import { makeRAGQuery, clearChatHistory } from "../utils/ragflow"

const router = Router()

const RAGQuerySchema = z.object({
  query: z.string(),
  userId: z.string().optional(),
  orgId: z.string().optional(),
})

const ClearHistorySchema = z.object({
  userId: z.string().optional(),
  orgId: z.string().optional(),
})

/**
 * Get Ingestion Status
 * GET /status
 */
router.get("/make_rag_query", async (req, res) => {
  try {
    const result = RAGQuerySchema.safeParse(req.query)

    if (!result.success) {
      return ResponseUtils.error(
        res,
        result.error.errors[0].message,
        400,
        "VALIDATION_ERROR"
      )
    }

    const { userId, orgId, query } = result.data
    const isOrg = Boolean(orgId)

    if (!userId && !orgId) {
      return ResponseUtils.error(
        res,
        "Authentication error",
        400,
        "VALIDATION_ERROR"
      )
    }

    const response = await makeRAGQuery({ userQuery: query, orgId, userId })

    ResponseUtils.success(res, response)
  } catch (error) {
    ResponseUtils.error(
      res,
      "Failed to get ai insights",
      500,
      "AI Insights error",
      error instanceof Error ? error.message : undefined
    )
  }
})

/**
 * Clear Chat History
 * POST /clear_history
 */
router.post("/clear_history", async (req, res) => {
  try {
    const result = ClearHistorySchema.safeParse(req.body)

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

    const threadId = (orgId || userId) as string
    clearChatHistory(threadId)

    ResponseUtils.success(res, { message: "Chat history cleared successfully" })
  } catch (error) {
    ResponseUtils.error(
      res,
      "Failed to clear chat history",
      500,
      "CLEAR_HISTORY_ERROR",
      error instanceof Error ? error.message : undefined
    )
  }
})

export default router
