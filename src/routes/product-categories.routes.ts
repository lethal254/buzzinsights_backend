import { Router } from "express"
import { ResponseUtils } from "../utils/response.utils"
import prisma from "../utils/prismaClient"
import { Prisma } from "@prisma/client"
import multer from "multer"
import { CSVUtils, CategoryCSVRow } from "../utils/csv.utils"
import {
  bulkParamsSchema,
  bulkProductCategoriesSchema,
} from "../schemas/product-category.schema"

const router = Router()
const upload = multer({ storage: multer.memoryStorage() })

// Create a new product category
router.post("/", async (req, res) => {
  try {
    const { name, description, keywords, versions, userId, orgId } = req.body

    if (!name || (!userId && !orgId)) {
      return ResponseUtils.error(
        res,
        "Name and either userId or orgId are required",
        400,
        "VALIDATION_ERROR"
      )
    }

    const isOrg = Boolean(orgId)

    const category = await prisma.productCategory.create({
      data: {
        name,
        description,
        keywords: Array.isArray(keywords)
          ? keywords
          : keywords
          ? [keywords]
          : [],
        versions: Array.isArray(versions)
          ? versions
          : versions
          ? [versions]
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
          "A product category with this name already exists",
          409,
          "DUPLICATE_ERROR"
        )
      }
    }
    ResponseUtils.error(res, "Failed to create product category")
  }
})

// Bulk import product categories from CSV
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
      true
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
        prisma.productCategory.create({
          data: {
            name: category.name,
            description: category.description ?? "",
            keywords: Array.isArray(category.keywords)
              ? category.keywords
              : category.keywords
              ? [category.keywords]
              : [],
            versions: Array.isArray(category.versions)
              ? category.versions
              : category.versions
              ? [category.versions]
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
      "Failed to import product categories",
      500,
      "IMPORT_ERROR",
      error instanceof Error ? error.message : undefined
    )
  }
})

// Bulk create product categories
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
    const bodyResult = bulkProductCategoriesSchema.safeParse(req.body)
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
        prisma.productCategory.create({
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
    ResponseUtils.error(res, "Failed to create product categories")
  }
})

// Get all product categories for a user/org
router.get("/", async (req, res) => {
  try {
    const userId =
      typeof req.query.userId === "string" ? req.query.userId : undefined
    const orgId =
      typeof req.query.orgId === "string" ? req.query.orgId : undefined

    if (!userId && !orgId) {
      return ResponseUtils.error(
        res,
        "Either userId or orgId is required",
        400,
        "VALIDATION_ERROR"
      )
    }

    const categories = await prisma.productCategory.findMany({
      where: {
        OR: [{ userId: userId || undefined }, { orgId: orgId || undefined }],
      },
      orderBy: {
        name: "asc",
      },
    })

    ResponseUtils.success(res, categories)
  } catch (error) {
    ResponseUtils.error(res, "Failed to fetch product categories")
  }
})

// Get a single product category
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params
    const category = await prisma.productCategory.findUnique({
      where: { id: parseInt(id) },
    })

    if (!category) {
      return ResponseUtils.error(
        res,
        "Product category not found",
        404,
        "NOT_FOUND"
      )
    }

    ResponseUtils.success(res, category)
  } catch (error) {
    ResponseUtils.error(res, "Failed to fetch product category")
  }
})

// Update a product category
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params
    const { name, description, keywords, versions, userId, orgId } = req.body

    const category = await prisma.productCategory.update({
      where: { id: parseInt(id) },
      data: {
        name,
        description,
        keywords: Array.isArray(keywords)
          ? keywords
          : keywords
          ? [keywords]
          : undefined,
        versions: Array.isArray(versions)
          ? versions
          : versions
          ? [versions]
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
          "Product category not found",
          404,
          "NOT_FOUND"
        )
      }
    }
    ResponseUtils.error(res, "Failed to update product category")
  }
})

// Delete a product category
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params
    await prisma.productCategory.delete({
      where: { id: parseInt(id) },
    })

    ResponseUtils.success(res, {
      message: "Product category deleted successfully",
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return ResponseUtils.error(
          res,
          "Product category not found",
          404,
          "NOT_FOUND"
        )
      }
    }
    ResponseUtils.error(res, "Failed to delete product category")
  }
})

export default router
