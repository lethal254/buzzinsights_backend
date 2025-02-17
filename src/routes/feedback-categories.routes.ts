import { Router } from "express"
import { ResponseUtils } from "../utils/response.utils"
import prisma from "../utils/prismaClient"
import { Prisma } from "@prisma/client"
import multer from "multer"
import { CSVUtils, CategoryCSVRow } from "../utils/csv.utils"
import {
  bulkFeedbackCategoriesSchema,
  bulkParamsSchema,
} from "../schemas/feedback-category.schema"

const router = Router()
const upload = multer({ storage: multer.memoryStorage() })

// Create a new feedback category
router.post("/", async (req, res) => {
  try {
    const { name, description, keywords, userId, orgId } = req.body

    if (!name || (!userId && !orgId)) {
      return ResponseUtils.error(
        res,
        "Name and either userId or orgId are required",
        400,
        "VALIDATION_ERROR"
      )
    }

    const isOrg = Boolean(orgId)

    const category = await prisma.feedbackCategory.create({
      data: {
        name,
        description,
        keywords: Array.isArray(keywords)
          ? keywords
          : keywords
          ? [keywords]
          : [],
        ...(!isOrg ? { userId } : {}),
        ...(isOrg ? { orgId } : {}),
      },
    })

    ResponseUtils.success(res, category, 201)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return ResponseUtils.error(
          res,
          "A feedback category with this name already exists",
          409,
          "DUPLICATE_ERROR"
        )
      }
    }
    ResponseUtils.error(res, "Failed to create feedback category")
  }
})

// Bulk import feedback categories from CSV
router.post("/bulk-import", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return ResponseUtils.error(
        res,
        "No file uploaded",
        400,
        "VALIDATION_ERROR"
      )
    }

    const { valid, invalid } = await CSVUtils.parseCategoryCSV(
      req.file.buffer,
      false
    )

    if (valid.length === 0) {
      return ResponseUtils.error(
        res,
        "No valid categories found in CSV",
        400,
        "VALIDATION_ERROR",
        { invalidRows: invalid }
      )
    }

    // Filter out entries without required userId
    const validWithUserId = valid.filter(
      (category) => category.userId || category.orgId
    )
    if (validWithUserId.length === 0) {
      return ResponseUtils.error(
        res,
        "No valid categories with required userId or orgId found in CSV",
        400,
        "VALIDATION_ERROR",
        { invalidRows: [...invalid, ...valid] }
      )
    }

    // Create categories in bulk
    const created = await prisma.$transaction(
      validWithUserId.map((category) =>
        prisma.feedbackCategory.create({
          data: {
            name: category.name,
            description: category.description ?? "",
            keywords: Array.isArray(category.keywords)
              ? category.keywords
              : category.keywords
              ? [category.keywords]
              : [],
            userId: category.userId!,
            orgId: category.orgId ?? null,
          },
        })
      )
    )

    ResponseUtils.success(
      res,
      {
        created,
        failedRows: invalid,
        summary: {
          total: valid.length + invalid.length,
          successful: created.length,
          failed: invalid.length,
        },
      },
      201
    )
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return ResponseUtils.error(
          res,
          "Duplicate category names found",
          409,
          "DUPLICATE_ERROR"
        )
      }
    }
    ResponseUtils.error(
      res,
      "Failed to import feedback categories",
      500,
      "IMPORT_ERROR",
      error instanceof Error ? error.message : undefined
    )
  }
})

// Bulk create feedback categories
router.post("/bulk", async (req, res) => {
  try {
    // Validate query parameters
    const paramsResult = bulkParamsSchema.safeParse(req.query)
    if (!paramsResult.success) {
      return ResponseUtils.error(
        res,
        paramsResult.error.errors[0].message,
        400,
        "VALIDATION_ERROR"
      )
    }

    // Validate request body
    const bodyResult = bulkFeedbackCategoriesSchema.safeParse(req.body)
    if (!bodyResult.success) {
      return ResponseUtils.error(
        res,
        bodyResult.error.errors[0].message,
        400,
        "VALIDATION_ERROR"
      )
    }

    const { userId, orgId } = paramsResult.data
    const { categories } = bodyResult.data
    const isOrg = Boolean(orgId)

    const created = await prisma.$transaction(
      categories.map((category) =>
        prisma.feedbackCategory.create({
          data: {
            ...category,
            ...(!isOrg ? { userId } : {}),
            ...(isOrg ? { orgId } : {}),
          },
        })
      )
    )

    ResponseUtils.success(res, created, 201)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return ResponseUtils.error(
          res,
          "Duplicate category names found",
          409,
          "DUPLICATE_ERROR"
        )
      }
    }
    ResponseUtils.error(res, "Failed to create feedback categories")
  }
})

// Get all feedback categories for a user/org
router.get("/", async (req, res) => {
  try {
    const { userId, orgId } = req.query

    if (!userId && !orgId) {
      return ResponseUtils.error(
        res,
        "Either userId or orgId is required",
        400,
        "VALIDATION_ERROR"
      )
    }

    // Convert query parameters to string or undefined
    const userIdStr = userId ? String(userId) : undefined
    const orgIdStr = orgId ? String(orgId) : undefined

    const categories = await prisma.feedbackCategory.findMany({
      where: {
        OR: [{ userId: userIdStr }, { orgId: orgIdStr }],
      },
      orderBy: {
        name: "asc",
      },
    })

    ResponseUtils.success(res, categories)
  } catch (error) {
    ResponseUtils.error(res, "Failed to fetch feedback categories")
  }
})

// Get a single feedback category
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params
    const category = await prisma.feedbackCategory.findUnique({
      where: { id: parseInt(id) },
    })

    if (!category) {
      return ResponseUtils.error(
        res,
        "Feedback category not found",
        404,
        "NOT_FOUND"
      )
    }

    ResponseUtils.success(res, category)
  } catch (error) {
    ResponseUtils.error(res, "Failed to fetch feedback category")
  }
})

// Update a feedback category
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params
    const { name, description, keywords, userId, orgId } = req.body

    const category = await prisma.feedbackCategory.update({
      where: { id: parseInt(id) },
      data: {
        name,
        description,
        keywords: Array.isArray(keywords)
          ? keywords
          : keywords
          ? [keywords]
          : undefined,
        userId,
        orgId,
      },
    })

    ResponseUtils.success(res, category)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return ResponseUtils.error(
          res,
          "Feedback category not found",
          404,
          "NOT_FOUND"
        )
      }
    }
    ResponseUtils.error(res, "Failed to update feedback category")
  }
})

// Delete a feedback category
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params
    await prisma.feedbackCategory.delete({
      where: { id: parseInt(id) },
    })

    ResponseUtils.success(res, {
      message: "Feedback category deleted successfully",
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return ResponseUtils.error(
          res,
          "Feedback category not found",
          404,
          "NOT_FOUND"
        )
      }
    }
    ResponseUtils.error(res, "Failed to delete feedback category")
  }
})

export default router
