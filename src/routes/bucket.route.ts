import { Router } from "express"
import { z } from "zod"
import prisma from "../utils/prismaClient"
import { ResponseUtils } from "../utils/response.utils"
import type { Request } from "express"
import { Prisma } from "@prisma/client"

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
