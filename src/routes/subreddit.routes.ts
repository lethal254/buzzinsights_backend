import { Router } from "express"
import { PrismaClient } from "@prisma/client"
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library"
import { ResponseUtils } from "../utils/response.utils"
import { z } from "zod"

const router = Router()
const prisma = new PrismaClient()

const createSubredditSchema = z.object({
  names: z.array(z.string().min(1, "Subreddit name cannot be empty")),
  userId: z.string().optional(),
  orgId: z.string().optional(),
  orgRole: z.string().optional(),
  keywords: z.array(z.string()).optional(),
})

// Create a new subreddit
router.post("/", async (req, res) => {
  try {
    const result = createSubredditSchema.safeParse(req.body)

    console.log(result)

    if (!result.success) {
      return ResponseUtils.error(
        res,
        result.error.errors[0].message,
        400,
        "VALIDATION_ERROR"
      )
    }

    const { names, userId, orgId, orgRole, keywords } = result.data

    if (!userId && !orgId) {
      return ResponseUtils.error(
        res,
        "Either userId or orgId must be provided",
        400,
        "VALIDATION_ERROR"
      )
    }
    const isOrg = Boolean(orgId)

    if (isOrg && orgRole !== "org:admin") {
      return ResponseUtils.error(
        res,
        "Only org:admin can create subreddits for an organization",
        403,
        "FORBIDDEN_ERROR"
      )
    }

    // Create multiple subreddits
    const subreddits = await Promise.all(
      names.map((name) =>
        prisma.subReddit.create({
          data: {
            name,
            ...(isOrg ? { orgId } : { userId }),
            ...(keywords ? { keywords } : {}),
          },
        })
      )
    )

    ResponseUtils.success(res, subreddits, 201)
  } catch (error) {
    if (
      error instanceof PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return ResponseUtils.error(
        res,
        "One or more subreddits already exist for this user/organization",
        409,
        "DUPLICATE_ERROR"
      )
    }
    ResponseUtils.error(
      res,
      "Failed to create subreddits",
      500,
      "INTERNAL_SERVER_ERROR",
      error instanceof Error ? error.message : undefined
    )
  }
})

// Get all subreddits for a user/org
router.get("/", async (req, res) => {
  try {
    const { userId, orgId } = req.query

    if (!userId && !orgId) {
      return ResponseUtils.error(
        res,
        "Either userId or orgId must be provided",
        400,
        "VALIDATION_ERROR"
      )
    }

    const subreddits = await prisma.subReddit.findMany({
      where: {
        OR: [{ userId: userId as string }, { orgId: orgId as string }],
      },
    })

    ResponseUtils.success(res, subreddits)
  } catch (error) {
    ResponseUtils.error(
      res,
      "Failed to fetch subreddits",
      500,
      "INTERNAL_SERVER_ERROR",
      error instanceof Error ? error.message : undefined
    )
  }
})

// Get a specific subreddit
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params

    const subreddit = await prisma.subReddit.findUnique({
      where: {
        id: parseInt(id),
      },
    })

    if (!subreddit) {
      return ResponseUtils.error(
        res,
        "Subreddit not found",
        404,
        "NOT_FOUND_ERROR"
      )
    }

    ResponseUtils.success(res, subreddit)
  } catch (error) {
    ResponseUtils.error(
      res,
      "Failed to fetch subreddit",
      500,
      "INTERNAL_SERVER_ERROR",
      error instanceof Error ? error.message : undefined
    )
  }
})

// Update a subreddit
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params
    const { name, keywords, isActive, userId, orgId, orgRole } = req.body
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
        "Only org:admin can update subreddits for an organization",
        403,
        "FORBIDDEN"
      )
    }

    // Verify ownership
    const existingSubreddit = await prisma.subReddit.findFirst({
      where: {
        id: parseInt(id),
        ...(isOrg ? { orgId } : { userId }),
      },
    })

    if (!existingSubreddit) {
      return ResponseUtils.error(
        res,
        "Subreddit not found or access denied",
        404,
        "NOT_FOUND_ERROR"
      )
    }

    const subreddit = await prisma.subReddit.update({
      where: {
        id: parseInt(id),
      },
      data: {
        ...(name ? { name } : {}),
        ...(keywords ? { keywords } : {}),
        ...(typeof isActive === "boolean" ? { isActive } : {}),
        updatedAt: new Date(),
      },
    })

    ResponseUtils.success(res, {
      message: "Subreddit updated successfully",
      subreddit,
    })
  } catch (error) {
    if (error instanceof PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return ResponseUtils.error(
          res,
          "Subreddit not found",
          404,
          "NOT_FOUND_ERROR"
        )
      }
      if (error.code === "P2002") {
        return ResponseUtils.error(
          res,
          "A subreddit with this name already exists",
          409,
          "DUPLICATE_ERROR"
        )
      }
    }
    ResponseUtils.error(
      res,
      "Failed to update subreddit",
      500,
      "INTERNAL_SERVER_ERROR",
      error instanceof Error ? error.message : undefined
    )
  }
})

// Delete a subreddit
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params
    const { userId, orgId, orgRole } = req.body

    console.log("***************", id)

    // Validate ID
    const numericId = Number(id)
    if (isNaN(numericId)) {
      return ResponseUtils.error(
        res,
        "Invalid ID format",
        400,
        "VALIDATION_ERROR"
      )
    }

    if (!userId && !orgId) {
      return ResponseUtils.error(
        res,
        "Either userId or orgId must be provided",
        400,
        "VALIDATION_ERROR"
      )
    }

    const isOrg = Boolean(orgId)

    if (isOrg && orgRole !== "org:admin") {
      return ResponseUtils.error(
        res,
        "Only org:admin can delete subreddits for an organization",
        403,
        "FORBIDDEN_ERROR"
      )
    }

    // Check if subreddit exists and belongs to user/org
    const subreddit = await prisma.subReddit.findFirst({
      where: {
        id: numericId,
        ...(isOrg ? { orgId: orgId } : { userId: userId }),
      },
    })

    if (!subreddit) {
      return ResponseUtils.error(
        res,
        "Subreddit not found or access denied",
        404,
        "NOT_FOUND_ERROR"
      )
    }

    const sub = await prisma.subReddit.delete({
      where: {
        id: numericId,
      },
    })

    ResponseUtils.success(res, sub, 201)
  } catch (error) {
    console.error("Delete subreddit error:", error)

    if (error instanceof PrismaClientKnownRequestError) {
      switch (error.code) {
        case "P2025":
          return ResponseUtils.error(
            res,
            "Subreddit not found",
            404,
            "NOT_FOUND_ERROR"
          )
        case "P2003":
          return ResponseUtils.error(
            res,
            "Related records exist",
            409,
            "CONFLICT_ERROR"
          )
        default:
          return ResponseUtils.error(
            res,
            "Database error",
            500,
            "DATABASE_ERROR",
            error.message
          )
      }
    }

    ResponseUtils.error(
      res,
      "Failed to delete subreddit",
      500,
      "INTERNAL_SERVER_ERROR",
      error instanceof Error ? error.message : undefined
    )
  }
})

export default router
