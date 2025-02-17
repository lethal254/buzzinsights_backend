import { z } from "zod"

const feedbackCategorySchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  keywords: z.array(z.string()).default([]),
})

export const bulkFeedbackCategoriesSchema = z.object({
  categories: z
    .array(feedbackCategorySchema)
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
