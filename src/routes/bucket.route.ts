import { Router } from "express"
import { z } from "zod"
import prisma from "../utils/prismaClient"
import { ResponseUtils } from "../utils/response.utils"
import type { Request } from "express"
import { Prisma } from "@prisma/client"
import { emailQueue } from "../queues/email.queue"
import { formatDistanceToNow } from "date-fns"

const router = Router()

// Validation schemas
const CreateBucketSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  userId: z.string().optional(),
  orgId: z.string().optional(),
  orgRole: z.string().optional(),
  priority: z.number().optional(),
}).refine(data => data.userId || data.orgId, {
  message: "Either userId or orgId must be provided"
})

const UpdateBucketSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  userId: z.string().optional(),
  orgId: z.string().optional(),
  orgRole: z.string().optional(),
  priority: z.number().optional(),
}).refine(data => data.userId || data.orgId, {
  message: "Either userId or orgId must be provided"
})

const QuerySchema = z.object({
  page: z.coerce.number().default(1),
  pageSize: z.coerce.number().default(10),
  userId: z.string().optional(),
  orgId: z.string().optional(),
  search: z.string().optional(),
  isActive: z.string().optional(),
}).refine(data => data.userId || data.orgId, {
  message: "Either userId or orgId must be provided"
})

// Helper function to send bucket notifications
async function sendBucketNotification(
  bucket: { name: string; description?: string | null },
  posts: { title: string; content: string; author: string; createdUtc: bigint; permalink?: string | null }[],
  emails: string[]
) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #2c3e50; border-bottom: 2px solid #eee; padding-bottom: 10px;">
        New Posts Added to Bucket: ${bucket.name}
      </h1>
      
      <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <h2 style="color: #2c3e50; margin-top: 0;">Bucket Details</h2>
        ${bucket.description ? `<p>${bucket.description}</p>` : ''}
        <p>Posts Added: ${posts.length}</p>
      </div>

      ${posts.map(post => `
        <div style="border: 1px solid #eee; padding: 15px; margin: 10px 0; border-radius: 5px;">
          <h3 style="margin: 0; color: #2c3e50;">${post.title}</h3>
          <p style="color: #666; font-size: 14px;">
            Posted by ${post.author} • ${formatDistanceToNow(new Date(Number(post.createdUtc) * 1000), { addSuffix: true })}
          </p>
          <p style="margin: 10px 0;">${post.content.slice(0, 150)}...</p>
          ${post.permalink ? `
            <a href="https://reddit.com${post.permalink}" 
              style="background: #0066cc; color: white; padding: 5px 10px; text-decoration: none; border-radius: 3px;">
              View Discussion
            </a>
          ` : ''}
        </div>
      `).join('')}
    </div>
  `

  await emailQueue.add('bucket-notification', {
    to: emails,
    subject: `New Posts Added to Bucket: ${bucket.name}`,
    content: html,
    timestamp: new Date()
  })
}

// POST /api/buckets - Create a new bucket
router.post("/", async (req: Request, res) => {
  try {
    const result = CreateBucketSchema.safeParse(req.body)
    if (!result.success) {
      return ResponseUtils.error(
        res,
        result.error.errors[0].message,
        400,
        "VALIDATION_ERROR"
      )
    }

    const { userId, orgId, orgRole, ...data } = result.data
    const isOrg = Boolean(orgId)

    if (isOrg && orgRole !== "org:admin") {
      return ResponseUtils.error(
        res,
        "Only org:admin can create buckets for an organization",
        403,
        "FORBIDDEN"
      )
    }

    const bucket = await prisma.feedbackBucket.create({
      data: {
        ...data,
        ...(isOrg ? { orgId } : { userId }),
        isActive: true,
      },
      include: {
        posts: true,
      },
    })

    return ResponseUtils.success(res, bucket)
  } catch (error) {
    console.error("Error creating bucket:", error)
    return ResponseUtils.error(
      res,
      "Failed to create bucket",
      500,
      "CREATE_BUCKET_ERROR",
      error instanceof Error ? error.message : String(error)
    )
  }
})

// GET /api/buckets - List all buckets
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
    const isOrg = Boolean(params.orgId)

    const where: Prisma.FeedbackBucketWhereInput = {
      AND: [
        params.userId ? { userId: params.userId } : {},
        params.orgId ? { orgId: params.orgId } : {},
        params.isActive ? { isActive: params.isActive === "true" } : {},
        params.search
          ? {
              OR: [
                { name: { contains: params.search, mode: "insensitive" as const } },
                { description: { contains: params.search, mode: "insensitive" as const } },
              ],
            }
          : {},
      ].filter(condition => Object.keys(condition).length > 0),
    }

    const total = await prisma.feedbackBucket.count({ where })

    const buckets = await prisma.feedbackBucket.findMany({
      where,
      include: {
        posts: true,
      },
      orderBy: {
        priority: "desc",
      },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    })

    return ResponseUtils.success(res, {
      buckets,
      pagination: {
        total,
        page: params.page,
        pageSize: params.pageSize,
        totalPages: Math.ceil(total / params.pageSize),
      },
    })
  } catch (error) {
    console.error("Error fetching buckets:", error)
    return ResponseUtils.error(
      res,
      "Failed to fetch buckets",
      500,
      "FETCH_BUCKETS_ERROR",
      error instanceof Error ? error.message : String(error)
    )
  }
})

// GET /api/buckets/:id - Get a single bucket
router.get("/:id", async (req: Request, res) => {
  try {
    const { id } = req.params
    const { userId, orgId } = req.query
    const isOrg = Boolean(orgId)

    if (!userId && !orgId) {
      return ResponseUtils.error(
        res,
        "Either userId or orgId must be provided",
        400,
        "VALIDATION_ERROR"
      )
    }

    const bucket = await prisma.feedbackBucket.findFirst({
      where: {
        id,
        ...(isOrg ? { orgId: orgId as string } : { userId: userId as string }),
      },
      include: {
        posts: true,
      },
    })

    if (!bucket) {
      return ResponseUtils.error(res, "Bucket not found", 404, "BUCKET_NOT_FOUND")
    }

    return ResponseUtils.success(res, bucket)
  } catch (error) {
    console.error("Error fetching bucket:", error)
    return ResponseUtils.error(
      res,
      "Failed to fetch bucket",
      500,
      "FETCH_BUCKET_ERROR",
      error instanceof Error ? error.message : String(error)
    )
  }
})

// PATCH /api/buckets/:id - Update a bucket
router.patch("/:id", async (req: Request, res) => {
  try {
    const { id } = req.params
    const result = UpdateBucketSchema.safeParse(req.body)
    if (!result.success) {
      return ResponseUtils.error(
        res,
        result.error.errors[0].message,
        400,
        "VALIDATION_ERROR"
      )
    }

    const { userId, orgId, orgRole, ...data } = result.data
    const isOrg = Boolean(orgId)

    if (isOrg && orgRole !== "org:admin") {
      return ResponseUtils.error(
        res,
        "Only org:admin can update buckets for an organization",
        403,
        "FORBIDDEN"
      )
    }

    // Verify ownership
    const existingBucket = await prisma.feedbackBucket.findFirst({
      where: {
        id,
        ...(isOrg ? { orgId } : { userId }),
      },
    })

    if (!existingBucket) {
      return ResponseUtils.error(
        res,
        "Bucket not found or access denied",
        404,
        "NOT_FOUND_ERROR"
      )
    }

    const bucket = await prisma.feedbackBucket.update({
      where: { id },
      data,
      include: {
        posts: true,
      },
    })

    return ResponseUtils.success(res, bucket)
  } catch (error) {
    console.error("Error updating bucket:", error)
    return ResponseUtils.error(
      res,
      "Failed to update bucket",
      500,
      "UPDATE_BUCKET_ERROR",
      error instanceof Error ? error.message : String(error)
    )
  }
})

// DELETE /api/buckets/:id - Delete a bucket
router.delete("/:id", async (req: Request, res) => {
  try {
    const { id } = req.params
    const { userId, orgId, orgRole } = req.query
    const isOrg = Boolean(orgId)

    if (!userId && !orgId) {
      return ResponseUtils.error(
        res,
        "Either userId or orgId must be provided",
        400,
        "VALIDATION_ERROR"
      )
    }

    if (isOrg && orgRole !== "org:admin") {
      return ResponseUtils.error(
        res,
        "Only org:admin can delete buckets for an organization",
        403,
        "FORBIDDEN"
      )
    }

    // Verify ownership
    const existingBucket = await prisma.feedbackBucket.findFirst({
      where: {
        id,
        ...(isOrg ? { orgId: orgId as string } : { userId: userId as string }),
      },
    })

    if (!existingBucket) {
      return ResponseUtils.error(
        res,
        "Bucket not found or access denied",
        404,
        "NOT_FOUND_ERROR"
      )
    }

    await prisma.feedbackBucket.delete({
      where: { id },
    })

    return ResponseUtils.success(res, { message: "Bucket deleted successfully" })
  } catch (error) {
    console.error("Error deleting bucket:", error)
    return ResponseUtils.error(
      res,
      "Failed to delete bucket",
      500,
      "DELETE_BUCKET_ERROR",
      error instanceof Error ? error.message : String(error)
    )
  }
})

// POST /api/buckets/:id/posts - Add posts to a bucket
router.post("/:id/posts", async (req: Request, res) => {
  try {
    const { id } = req.params
    const { postIds, userId, orgId, orgRole } = req.body
    const isOrg = Boolean(orgId)

    if (!userId && !orgId) {
      return ResponseUtils.error(
        res,
        "Either userId or orgId must be provided",
        400,
        "VALIDATION_ERROR"
      )
    }

    if (!Array.isArray(postIds)) {
      return ResponseUtils.error(
        res,
        "postIds must be an array",
        400,
        "VALIDATION_ERROR"
      )
    }

    // Verify ownership
    const existingBucket = await prisma.feedbackBucket.findFirst({
      where: {
        id,
        ...(isOrg ? { orgId } : { userId }),
      },
    })

    if (!existingBucket) {
      return ResponseUtils.error(
        res,
        "Bucket not found or access denied",
        404,
        "NOT_FOUND_ERROR"
      )
    }

    // Get the posts being added
    const posts = await prisma.redditPost.findMany({
      where: {
        id: { in: postIds }
      },
      select: {
        title: true,
        content: true,
        author: true,
        createdUtc: true,
        permalink: true,
        addedToBucketByAI: true
      }
    })

    // Filter posts that were added by AI
    const aiAddedPosts = posts.filter(post => post.addedToBucketByAI)

    const bucket = await prisma.feedbackBucket.update({
      where: { id },
      data: {
        posts: {
          connect: postIds.map((postId: string) => ({ id: postId })),
        },
      },
      include: {
        posts: true,
      },
    })

    // Only send notification if there are posts added by AI
    if (aiAddedPosts.length > 0) {
      // Get user preferences for notifications
      const preferences = await prisma.preferences.findFirst({
        where: isOrg ? { orgId } : { userId },
        select: {
          emails: true
        }
      })

      if (preferences?.emails && preferences.emails.length > 0) {
        await sendBucketNotification(
          {
            name: bucket.name,
            description: bucket.description
          },
          aiAddedPosts,
          preferences.emails
        )
      }
    }

    return ResponseUtils.success(res, bucket)
  } catch (error) {
    console.error("Error adding posts to bucket:", error)
    return ResponseUtils.error(
      res,
      "Failed to add posts to bucket",
      500,
      "ADD_POSTS_TO_BUCKET_ERROR",
      error instanceof Error ? error.message : String(error)
    )
  }
})

// DELETE /api/buckets/:id/posts - Remove posts from a bucket
router.delete("/:id/posts", async (req: Request, res) => {
  try {
    const { id } = req.params
    const { postIds, userId, orgId, orgRole } = req.body
    const isOrg = Boolean(orgId)

    if (!userId && !orgId) {
      return ResponseUtils.error(
        res,
        "Either userId or orgId must be provided",
        400,
        "VALIDATION_ERROR"
      )
    }

    if (!Array.isArray(postIds)) {
      return ResponseUtils.error(
        res,
        "postIds must be an array",
        400,
        "VALIDATION_ERROR"
      )
    }

    // Verify ownership
    const existingBucket = await prisma.feedbackBucket.findFirst({
      where: {
        id,
        ...(isOrg ? { orgId } : { userId }),
      },
    })

    if (!existingBucket) {
      return ResponseUtils.error(
        res,
        "Bucket not found or access denied",
        404,
        "NOT_FOUND_ERROR"
      )
    }

    const bucket = await prisma.feedbackBucket.update({
      where: { id },
      data: {
        posts: {
          disconnect: postIds.map((postId: string) => ({ id: postId })),
        },
      },
      include: {
        posts: true,
      },
    })

    return ResponseUtils.success(res, bucket)
  } catch (error) {
    console.error("Error removing posts from bucket:", error)
    return ResponseUtils.error(
      res,
      "Failed to remove posts from bucket",
      500,
      "REMOVE_POSTS_FROM_BUCKET_ERROR",
      error instanceof Error ? error.message : String(error)
    )
  }
})

export default router
