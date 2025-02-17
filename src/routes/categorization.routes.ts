import { Router } from "express"
import {
  startCategorization,
  stopCategorization,
} from "../queues/categorization.queue"
import { ResponseUtils } from "../utils/response.utils"
import prisma from "../utils/prismaClient"

const router = Router()

router.post("/start-categorization", async (req, res) => {
  try {
    const { orgId, userId, orgRole } = req.body

    if (!orgId && !userId) {
      return ResponseUtils.error(
        res,
        "Either organizationId or userId is required",
        400,
        "VALIDATION_ERROR"
      )
    }

    // Use organizationId if available, otherwise use userId
    const targetId = orgId || userId
    const isOrg = Boolean(orgId)

    if (isOrg && orgRole !== "org:admin") {
      return ResponseUtils.error(
        res,
        "Only org:admin can start categorization for an organization",
        403,
        "FORBIDDEN"
      )
    }

    // Update preferences to enable categorization
    await prisma.preferences.upsert({
      where: isOrg ? { orgId: targetId } : { userId: targetId },
      update: {
        triggerCategorization: true,
      },
      create: {
        ...(isOrg ? { orgId: targetId } : { userId: targetId }),
        triggerCategorization: true,
      },
    })

    await startCategorization(targetId, isOrg)

    ResponseUtils.success(res, {
      message: "Categorization process started successfully",
      status: "queued",
    })
  } catch (error) {
    ResponseUtils.error(
      res,
      "Failed to start categorization process",
      500,
      "CATEGORIZATION_ERROR",
      error instanceof Error ? error.message : undefined
    )
  }
})

router.post("/stop-categorization", async (req, res) => {
  try {
    const { orgId, userId, orgRole } = req.body

    if (!orgId && !userId) {
      return ResponseUtils.error(
        res,
        "Either organizationId or userId is required",
        400,
        "VALIDATION_ERROR"
      )
    }

    // Use organizationId if available, otherwise use userId
    const targetId = orgId || userId
    const isOrg = Boolean(orgId)

    if (isOrg && orgRole !== "org:admin") {
      return ResponseUtils.error(
        res,
        "Only org:admin can stop categorization for an organization",
        403,
        "FORBIDDEN"
      )
    }

    // Update preferences to disable categorization
    await prisma.preferences.update({
      where: isOrg ? { orgId: targetId } : { userId: targetId },
      data: {
        triggerCategorization: false,
      },
    })

    const result = await stopCategorization(targetId, isOrg)

    ResponseUtils.success(res, {
      message: "Categorization process stopped successfully",
      status: "stopped",
      ...result,
    })
  } catch (error) {
    ResponseUtils.error(
      res,
      "Failed to stop categorization process",
      500,
      "CATEGORIZATION_ERROR",
      error instanceof Error ? error.message : undefined
    )
  }
})

router.get("/openai", async (req, res) => {
  try {
    const response = "Hi"
    res.send(response)
  } catch (error) {
    res.status(500).send(error)
  }
})

export default router
