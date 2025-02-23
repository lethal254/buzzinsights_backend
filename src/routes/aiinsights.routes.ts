import { Router } from "express"
import { z } from "zod"
import { ResponseUtils } from "../utils/response.utils"
import { makeRAGQuery, clearChatHistory } from "../utils/ragflow"
import { chatModel } from "../utils/aiConfig"

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

const SummarySchema = z.object({
  userId: z.string().optional(),
  orgId: z.string().optional(),
  payload: z.string(),
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

router.post("/summary", async (req, res) => {
  const bodyResult = SummarySchema.safeParse(req.body)

  if (!bodyResult.success) {
    return ResponseUtils.error(
      res,
      bodyResult.error.errors[0].message,
      400,
      "VALIDATION_ERROR"
    )
  }

  const { userId, orgId, payload } = bodyResult.data
  const isOrg = Boolean(orgId)

  if (!userId && !orgId) {
    return ResponseUtils.error(
      res,
      "Authentication error",
      400,
      "VALIDATION_ERROR"
    )
  }

  const promptTemplate = `
  You are an AI assistant tasked with analyzing Reddit feedback. Please analyze the following feedback post and provide a comprehensive analysis:
  
  Post Schema:
  title - The headline or title of the Reddit post.
  content - The main text body of the post, containing detailed feedback.
  author - The username or identifier of the person who created the post.
  createdUtc - The Unix timestamp (in UTC) representing when the post was originally created.
  score - The overall score of the post, typically reflecting upvotes minus downvotes.
  numComments - The number of comments that have been made on the post.
  lastUpdated - The Unix timestamp indicating when the post was last updated.
  needsProcessing - A boolean flag indicating whether this post still requires further processing (default is true).
  processingPriority - A numeric value representing the priority for processing this post (default is 0).
  sentimentScore - An optional numerical score representing the sentiment of the post.
  sentimentCategory - An optional label categorizing the sentiment (e.g., positive, negative, or neutral).
  category - An optional label or tag that categorizes the type of feedback.
  product - An optional field specifying the product or service to which the feedback relates.
  sameIssuesCount - An optional count (default 0) of how many times similar issues have been reported by other users in the comment section.
  sameDeviceCount - An optional count (default 0) of similar issues reported on the same device in the comment section.
  solutionsCount - An optional count (default 0) of proposed solutions mentioned in the feedback in the comment section.
  updateIssueMention - An optional count (default 0) of number of users in the comments who mentioned uninstalling/reinstalling/updating fixed the issue.
  comments - An array of RedditComment objects containing the comments on the post.
  
  Please provide your analysis covering the following sections:
  
  - **Overview:**  
    Summarize the overall context and content of the post.
  
  - **Content Analysis:**  
    Identify key themes, topics, and sentiments within the title and content.
  
  - **Engagement Metrics:**  
    Discuss the post's engagement using metrics like score, numComments, and any insights from lastUpdated or processingPriority.
  
  - **Sentiment Evaluation:**  
    Evaluate the sentiment of the post using sentimentScore and sentimentCategory.
  
  - **Feedback Specifics:**  
    Analyze detailed feedback aspects including category, product, sameIssuesCount, sameDeviceCount, solutionsCount, updateIssueMention, and updateResolvedMention.

  - **Comments Analysis:**  
    If comments are provided, examine their content for additional insights.
  
  - **Summary:**  
    Provide a concise summary highlighting the key points of your analysis.
  
  Format your response in markdown with clear sections and bullet points. Do not provide any recommendations—focus solely on delivering an objective, detailed analysis of the provided feedback.

  Here is the post: ${payload}
  `

  try {
    const response = await chatModel.invoke(promptTemplate)

    ResponseUtils.success(res, {
      summary: response.content,
    })
  } catch (error) {
    ResponseUtils.error(
      res,
      "Failed to generate summary",
      500,
      "SUMMARY_ERROR",
      error instanceof Error ? error.message : undefined
    )
  }
})

export default router
