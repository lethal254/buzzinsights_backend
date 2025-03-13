import { Router } from "express"
import {
  categorizationQueue,
  startCategorization,
  stopCategorization,
} from "../queues/categorization.queue"
import { ResponseUtils } from "../utils/response.utils"
import prisma from "../utils/prismaClient"
import { masterAuthMiddleware } from "../middlewares/basicAuth"
import { createLogger, transports, format } from "winston"
import { JobType } from "bullmq"

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

const logger = createLogger({
  level: "info",
  format: format.combine(format.timestamp(), format.json()),
  transports: [
    new transports.Console(),
    new transports.File({ filename: "categorization.log" }),
  ],
})

router.get("/master/kill-all", masterAuthMiddleware, async (req, res) => {
  try {
    logger.warn("Master kill-all categorization jobs initiated")

    // Get all repeatable jobs
    const repeatableJobs = await categorizationQueue.getRepeatableJobs()

    // Get all jobs in various states
    const states = ["active", "waiting", "delayed", "paused"]
    const allJobs = await Promise.all(
      states.map((state) => categorizationQueue.getJobs([state as JobType]))
    )

    const results = {
      repeatableRemoved: 0,
      jobsStopped: 0,
      errors: [] as string[],
    }

    // Remove all repeatable jobs
    for (const job of repeatableJobs) {
      try {
        if (job.key) {
          await categorizationQueue.removeRepeatableByKey(job.key)
          results.repeatableRemoved++
        }
      } catch (error) {
        results.errors.push(`Failed to remove repeatable job ${job.key}`)
      }
    }

    // Stop all existing jobs
    for (const jobs of allJobs.flat()) {
      try {
        const state = await jobs.getState()
        if (state === "active") {
          await jobs.moveToFailed(
            new Error("Emergency stop: master kill-all initiated"),
            true
          )
        } else {
          await jobs.remove()
        }
        results.jobsStopped++
      } catch (error) {
        results.errors.push(`Failed to stop job ${jobs.id}`)
      }
    }

    // Update all preferences to disable categorization
    await prisma.preferences.updateMany({
      where: {
        triggerCategorization: true,
      },
      data: {
        triggerCategorization: false,
      },
    })

    logger.warn("Master kill-all completed", results)

    ResponseUtils.success(res, {
      message: "All categorization jobs killed",
      results,
    })
  } catch (error) {
    logger.error("Master kill-all failed", { error })
    ResponseUtils.error(
      res,
      "Failed to kill all categorization jobs",
      500,
      "MASTER_KILL_ERROR",
      error instanceof Error ? error.message : undefined
    )
  }
})

export default router
