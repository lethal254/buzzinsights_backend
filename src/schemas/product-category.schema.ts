import { z } from "zod"

const productCategorySchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  keywords: z.array(z.string()).default([]),
  versions: z.array(z.string()).default([]),
})

export const bulkProductCategoriesSchema = z.object({
  categories: z
    .array(productCategorySchema)
    .min(1, "At least one category is required")
    .max(100, "Maximum 100 categories allowed per request"),
})

export const bulkParamsSchema = z
  .object({
    userId: z.string().optional(),
    orgId: z.string().optional(),
  })
  .refine((data) => data.userId || data.orgId, {
    message: "Either userId or orgId must be provided",
  })
