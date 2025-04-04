import { Router } from "express"
import { z } from "zod"
import prisma from "../utils/prismaClient"
import { ResponseUtils } from "../utils/response.utils"
import type { Request } from "express"
import { Prisma } from "@prisma/client"

const router = Router()

// Helper function to serialize BigInt fields
const serializePost = (post: any) => {
  return {
    ...post,
    createdUtc: Number(post.createdUtc),
    lastUpdated: post.lastUpdated ? Number(post.lastUpdated) : null,
    comments: post.comments?.map((comment: any) => ({
      ...comment,
      createdUtc: Number(comment.createdUtc),
      lastUpdated: Number(comment.lastUpdated),
      replies: comment.replies?.map((reply: any) => ({
        ...reply,
        createdUtc: Number(reply.createdUtc),
        lastUpdated: Number(reply.lastUpdated),
      })),
    })),
  }
}

// Query schema with proper validation
const QuerySchema = z.object({
  page: z.coerce.number().default(1),
  pageSize: z.coerce.number().default(10),
  category: z.string().optional(),
  product: z.string().optional(),
  feedbackCategory: z.string().optional(),
  window: z.coerce.number().optional(),
  sortBy: z.enum(["createdUtc", "numComments", "score"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  userId: z.string().optional(),
  orgId: z.string().optional(),
  search: z.string().optional(),
  hideNoise: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sentimentCategory: z.string().optional(),
})

// GET /api/posts
router.get("/", async (req: Request, res) => {
  try {
    const result = QuerySchema.safeParse(req.query)

    if (!result.success) {
      return ResponseUtils.error(
        res,
        result.error.errors[0].message,
        400,
        "VALIDATION_ERROR"
      )
    }

    const params = result.data

    // Calculate the timestamp for the window
    const currentWindowStart = params.window
      ? new Date().getTime() - params.window * 60 * 60 * 1000
      : undefined

    console.log(params.hideNoise)

    // Build where clause
    const where: any = {
      AND: [
        params.hideNoise ? { category: { not: "Noise" } } : undefined,
        params.userId ? { userId: params.userId } : undefined,
        params.orgId ? { orgId: params.orgId } : undefined,
        params.category ? { category: params.category } : undefined,
        params.product ? { product: params.product } : undefined,
        params.feedbackCategory
          ? { feedbackCategory: params.feedbackCategory }
          : undefined,
        params.sentimentCategory
          ? { sentimentCategory: params.sentimentCategory }
          : undefined,
        // Handle both date range and time window
        {
          createdUtc: {
            ...(params.startDate
              ? { gte: Math.floor(new Date(params.startDate).getTime() / 1000) }
              : currentWindowStart
              ? { gte: Math.floor(currentWindowStart / 1000) }
              : {}),
            ...(params.endDate
              ? { lte: Math.floor(new Date(params.endDate).getTime() / 1000) }
              : {}),
          },
        },
        params.search
          ? {
              OR: [
                { title: { contains: params.search, mode: "insensitive" } },
                { content: { contains: params.search, mode: "insensitive" } },
              ],
            }
          : undefined,
      ].filter(Boolean), // Remove undefined values
    }

    console.log("where", where)

    // Add sort by clause

    const orderBy: Prisma.RedditPostOrderByWithRelationInput = {
      [params.sortBy || "createdUtc"]: params.sortOrder || "desc",
    }
    // Get total count
    const total = await prisma.redditPost.count({ where })

    // Get filtered posts with comments
    const posts = await prisma.redditPost.findMany({
      where,
      include: {
        comments: {
          include: {
            replies: true,
          },
          orderBy: { score: "desc" },
        },
      },
      orderBy,
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    })

    // Serialize posts before sending
    const serializedPosts = posts.map(serializePost)

    return ResponseUtils.success(res, {
      posts: serializedPosts,
      pagination: {
        total,
        page: params.page,
        pageSize: params.pageSize,
        totalPages: Math.ceil(total / params.pageSize),
      },
    })
  } catch (error) {
    console.error("Error fetching posts:", error)
    return ResponseUtils.error(
      res,
      "Failed to fetch posts",
      500,
      "FETCH_POSTS_ERROR",
      error instanceof Error ? error.message : String(error)
    )
  }
})

const GetSinglePostParamSchema = z.object({
  id: z.string(),
})
const GetSinglePostQuerySchema = z.object({
  userId: z.string().optional(),
  orgId: z.string().optional(),
})
const GetSinglePostSchema = GetSinglePostParamSchema.merge(
  GetSinglePostQuerySchema
)

// GET /api/posts/:id
router.get("/:id", async (req, res) => {
  try {
    const result = GetSinglePostSchema.safeParse({
      id: req.params.id,
      userId: req.query.userId,
      orgId: req.query.orgId,
    })
    console.log(result.data)

    if (!result.success) {
      return ResponseUtils.error(
        res,
        result.error.errors[0].message,
        400,
        "VALIDATION_ERROR"
      )
    }

    const params = result.data

    // Get post from prisma using post id and user/org id
    const post = await prisma.redditPost.findFirst({
      where: {
        id: params.id,
        userId: params.userId || undefined,
        orgId: params.orgId || undefined,
      },
      include: {
        comments: {
          include: {
            replies: true,
          },
          orderBy: { score: "desc" },
        },
      },
    })

    if (!post) {
      return ResponseUtils.error(res, "Post not found", 404, "POST_NOT_FOUND")
    }

    return ResponseUtils.success(res, serializePost(post))
  } catch (error) {
    console.error("Error fetching post:", error)
    return ResponseUtils.error(
      res,
      "Failed to fetch post",
      500,
      "FETCH_POST_ERROR",
      error instanceof Error ? error.message : String(error)
    )
  }
})

export default router
