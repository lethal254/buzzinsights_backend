import {
  NotificationJobData,
  NotificationMetrics,
  CategoryTrend,
} from "../types/notification"
import { PrismaClient, RedditPost, Preferences } from "@prisma/client"
import Queue from "bull"
import { emailQueue } from "./email.queue"

const prisma = new PrismaClient()

export const notificationQueue = new Queue<NotificationJobData>(
  "notification",
  {
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false,
    },
  }
)

// Helper function to calculate category trends
function calculateCategoryTrends(
  currentPosts: RedditPost[],
  previousPosts: RedditPost[]
): CategoryTrend[] {
  const currentCounts = new Map<string, RedditPost[]>()
  const previousCounts = new Map<string, number>()

  currentPosts.forEach((post) => {
    const category = post.category || "uncategorized"
    if (!currentCounts.has(category)) {
      currentCounts.set(category, [])
    }
    currentCounts.get(category)!.push(post)
  })

  previousPosts.forEach((post) => {
    const category = post.category || "uncategorized"
    previousCounts.set(category, (previousCounts.get(category) || 0) + 1)
  })

  return Array.from(currentCounts.entries()).map(([category, posts]) => ({
    category,
    currentCount: posts.length,
    previousCount: previousCounts.get(category) || 0,
    posts: posts.map((post) => ({
      id: post.id,
      title: post.title,
      numComments: post.numComments,
      sentimentScore: post.sentimentScore,
      sentimentCategory: post.sentimentCategory,
      category: post.category,
      createdUtc: post.createdUtc,
      lastUpdated: post.lastUpdated,
    })),
  }))
}

notificationQueue.process("notification-job", async (job) => {
  if (!job || !job.data) {
    console.error("Invalid job received:", job)
    return
  }

  const { targetId, isOrg } = job.data

  try {
    const settings = await prisma.preferences.findFirst({
      where: {
        ...(isOrg ? { orgId: targetId } : { userId: targetId }),
        enabled: true,
      },
    })

    console.log("Processing notification job:", {
      targetId,
      isOrg,
      settings: settings?.id,
      enabled: settings?.enabled,
    })

    if (!settings) {
      console.log("No settings found or notifications disabled")
      return
    }

    const currentTime = BigInt(Math.floor(Date.now() / 1000))
    const hourInSeconds = BigInt(3600)
    const timeWindowInSeconds = BigInt(settings.timeWindow) * hourInSeconds

    const [currentPosts, previousPosts] = await Promise.all([
      prisma.redditPost.findMany({
        where: {
          ...(isOrg ? { orgId: targetId } : { userId: targetId }),
          createdUtc: {
            gte: currentTime - timeWindowInSeconds,
          },
        },
        include: {
          comments: true,
        },
      }),
      prisma.redditPost.findMany({
        where: {
          ...(isOrg ? { orgId: targetId } : { userId: targetId }),
          createdUtc: {
            gte: currentTime - timeWindowInSeconds * BigInt(2),
            lt: currentTime - timeWindowInSeconds,
          },
        },
      }),
    ])

    console.log("Posts found:", {
      current: currentPosts.length,
      previous: previousPosts.length,
    })

    const metrics: NotificationMetrics = {
      currentCount: currentPosts.length,
      previousCount: previousPosts.length,
      currentCommentCount: currentPosts.reduce(
        (sum, post) => sum + post.numComments,
        0
      ),
      previousCommentCount: previousPosts.reduce(
        (sum, post) => sum + post.numComments,
        0
      ),
      averageSentiment:
        currentPosts.reduce(
          (sum, post) => sum + (post.sentimentScore || 0),
          0
        ) / currentPosts.length || 0,
      commentGrowthRate: calculateCommentGrowthRate(
        currentPosts.reduce((sum, post) => sum + post.numComments, 0),
        previousPosts.reduce((sum, post) => sum + post.numComments, 0)
      ),
      categoryTrends: calculateCategoryTrends(currentPosts, previousPosts),
    }

    console.log("Calculated Metrics:", metrics)

    // Store window metrics
    await prisma.windowMetrics.create({
      data: {
        userId: isOrg ? null : targetId,
        orgId: isOrg ? targetId : null,
        totalPosts: metrics.currentCount,
        totalComments: metrics.currentCommentCount,
        totalUpvotes: currentPosts.reduce((sum, post) => sum + post.score, 0),
        topTrendingPosts: JSON.stringify(
          currentPosts.slice(0, 5).map((post) => ({
            id: post.id,
            title: post.title,
            upvotes: post.score,
            comments: post.numComments,
            createdUtc: Number(post.createdUtc), // Convert BigInt to number
            lastUpdated: Number(post.lastUpdated), // Convert BigInt to number
          }))
        ),
        categoryTrends: JSON.stringify(
          metrics.categoryTrends.map((trend) => ({
            ...trend,
            posts: trend.posts.map((post) => ({
              ...post,
              createdUtc: Number(post.createdUtc),
              lastUpdated: Number(post.lastUpdated),
            })),
          }))
        ),
        sentimentAnalysis: JSON.stringify(metrics.averageSentiment),
        sameIssuesCount: 0, // Default value for now
        sameDeviceCount: 0, // Default value for now
        solutionsCount: 0, // Default value for now
        updateIssueMention: 0, // Default value for now
        updateResolvedMention: 0, // Default value for now
      },
    })

    const shouldSend = shouldSendNotification(metrics, settings)
    console.log("Should send notification:", {
      shouldSend,
      triggers: {
        commentGrowth:
          metrics.commentGrowthRate >= settings.commentGrowthThreshold,
        sentiment: metrics.averageSentiment <= settings.sentimentThreshold,
        categoryTrend: metrics.categoryTrends.some(
          (trend) =>
            trend.currentCount >= settings.issueThreshold &&
            trend.currentCount >=
              trend.previousCount * settings.volumeThresholdMultiplier
        ),
      },
      thresholds: {
        comment: settings.commentGrowthThreshold,
        sentiment: settings.sentimentThreshold,
        issue: settings.issueThreshold,
        volume: settings.volumeThresholdMultiplier,
      },
    })

    if (shouldSend) {
      console.log("Attempting to send notification email")
      await sendNotificationEmail(metrics, settings)

      await prisma.notificationHistory.create({
        data: {
          userId: isOrg ? null : targetId,
          orgId: isOrg ? targetId : null,
          postIds: currentPosts.map((p) => p.id),
          category: currentPosts[0]?.category || "uncategorized",
          product: currentPosts[0]?.product || "unknown",
          issueCount: metrics.currentCount,
          emailsSentTo: settings.emails,
        },
      })

      await prisma.preferences.update({
        where: { id: settings.id },
        data: { lastNotified: new Date() },
      })
    }
  } catch (error) {
    console.error("Notification processing error:", error)
    throw error
  }
})

function calculateCommentGrowthRate(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? Infinity : 0
  return current / previous
}

function shouldSendNotification(
  metrics: NotificationMetrics,
  settings: Preferences
): boolean {
  const triggers = {
    commentGrowth: metrics.commentGrowthRate >= settings.commentGrowthThreshold,
    sentiment: metrics.averageSentiment <= settings.sentimentThreshold,
    categoryTrend: metrics.categoryTrends.some(
      (trend) =>
        trend.currentCount >= settings.issueThreshold &&
        trend.currentCount >=
          trend.previousCount * settings.volumeThresholdMultiplier
    ),
  }

  console.log("Notification Triggers:", triggers)

  return triggers.commentGrowth || triggers.sentiment || triggers.categoryTrend
}

async function sendNotificationEmail(
  metrics: NotificationMetrics,
  settings: Preferences
) {
  console.log("Attempting to send email to:", settings.emails)

  // Serialize the metrics data with BigInt handling
  const serializedMetrics = serializeBigInt(metrics)
  const notificationContent = JSON.stringify(serializedMetrics, null, 2)

  try {
    const emailJob = await emailQueue.add({
      to: settings.emails,
      subject: `Social Eye Analytics Report - ${new Date().toLocaleDateString()}`,
      content: notificationContent,
      timestamp: new Date(),
    })
    console.log("Email job created:", emailJob.id)

    // Save notification history
    await prisma.notificationHistory.create({
      data: {
        userId: settings.userId,
        orgId: settings.orgId,
        postIds: metrics.categoryTrends.flatMap((trend) =>
          trend.posts.map((post) => post.id)
        ),
        category: "General", // Assuming a general category, adjust as needed
        issueCount: metrics.categoryTrends.length,
        emailsSentTo: settings.emails,
      },
    })
    console.log("Notification history saved.")
  } catch (error) {
    console.error("Failed to create email job:", error)
    throw error
  }
}

// Helper function to safely serialize BigInt values
const serializeBigInt = (obj: any): any => {
  if (obj === null || obj === undefined) {
    return obj
  }

  // Handle BigInt values
  if (typeof obj === "bigint") {
    return Number(obj)
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(serializeBigInt)
  }

  // Handle objects
  if (typeof obj === "object") {
    const result: { [key: string]: any } = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeBigInt(value)
    }
    return result
  }

  return obj
}

// Add a helper function to get a unique job name
function getNotificationJobName(targetId: string, isOrg: boolean): string {
  return `notifications:${isOrg ? "org" : "user"}:${targetId}`
}

export async function startNotifications(
  targetId: string,
  isOrg: boolean,
  interval: number
) {
  const jobName = getNotificationJobName(targetId, isOrg)

  // Get all jobs for this target
  const repeatableJobs = await notificationQueue.getRepeatableJobs()
  const existingJobs = repeatableJobs.filter(
    (job) =>
      job?.name === "notification-job" && job?.id && job.id.includes(targetId)
  )

  // Remove any existing jobs for this target
  for (const job of existingJobs) {
    if (job?.key) {
      await notificationQueue.removeRepeatableByKey(job.key)
      console.log(`Removed existing job: ${job.key}`)
    }
  }

  // Wait a moment to ensure cleanup
  await new Promise((resolve) => setTimeout(resolve, 1000))

  // Create new job
  const newJob = await notificationQueue.add(
    "notification-job",
    { targetId, isOrg },
    {
      jobId: jobName,
      repeat: {
        every: interval, // Use custom interval
      },
      removeOnComplete: true,
      removeOnFail: false,
    }
  )

  console.log(`Started notification job: ${jobName}`, newJob.id)
}

export async function stopNotifications(targetId: string, isOrg: boolean) {
  // Get all repeatable jobs
  const repeatableJobs = await notificationQueue.getRepeatableJobs()

  // Find jobs for this target
  const existingJobs = repeatableJobs.filter(
    (job) =>
      job?.name === "notification-job" && job?.id && job.id.includes(targetId)
  )

  // Remove all matching jobs
  for (const job of existingJobs) {
    if (job?.key) {
      await notificationQueue.removeRepeatableByKey(job.key)
      console.log(
        `Stopped notification job with key: ${job.key} for target: ${targetId}`
      )
    }
  }

  // Also clean up any waiting jobs
  const waitingJobs = await notificationQueue.getWaiting()
  for (const job of waitingJobs) {
    if (job.data.targetId === targetId && job.data.isOrg === isOrg) {
      await job.remove()
      console.log(`Removed waiting job: ${job.id} for target: ${targetId}`)
    }
  }

  // Clean up delayed jobs
  const delayedJobs = await notificationQueue.getDelayed()
  for (const job of delayedJobs) {
    if (job.data.targetId === targetId && job.data.isOrg === isOrg) {
      await job.remove()
      console.log(`Removed delayed job: ${job.id} for target: ${targetId}`)
    }
  }
}

function generateEmailContent(
  metrics: NotificationMetrics,
  settings: Preferences
): string {
  const trendingCategories = metrics.categoryTrends
    .filter(
      (trend) =>
        trend.currentCount > trend.previousCount && trend.category !== "Noise"
    )
    .sort((a, b) => b.currentCount - a.currentCount)

  const formatDate = (date: Date) => {
    return date.toLocaleString("en-US", {
      month: "numeric",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: true,
    })
  }

  // Pre-process the category updates
  let categoryUpdates = ""
  for (const cat of trendingCategories) {
    const posts = cat.posts
      .sort((a, b) => b.numComments - a.numComments)
      .slice(0, 3)

    categoryUpdates += `
      <h3>📈 ${cat.category} Update</h3>
      ${
        cat.previousCount > 0
          ? `<p>Activity is up with ${
              cat.currentCount - cat.previousCount
            } new discussions since last check.</p>`
          : `<p>New discussions have started in this category.</p>`
      }
      <p>Here are the most active conversations:</p>`

    for (const post of posts) {
      categoryUpdates += `
        <p><strong>${post.title}</strong></p>
        <p>${post.numComments} people are discussing this</p>`
    }
  }

  // Create the trends summary
  const trendsSummary = trendingCategories
    .map(
      (trend) =>
        `${trend.category} (${
          trend.previousCount > 0
            ? trend.currentCount - trend.previousCount + " new discussions"
            : "new topic"
        })`
    )
    .join(", ")

  return `
    <h1>Social Eye Services Alert</h1>
    <h2>👋 Hey there!</h2>
    <p>Here's your latest community activity briefing. Let me catch you up on what's happening...</p>

    <p>In the last ${
      settings.timeWindow
    } hours, we've noticed some interesting trends in your community discussions:</p>
    <p>${trendsSummary}</p>

    ${categoryUpdates}

    <p>This briefing covers activity from ${formatDate(
      new Date(Date.now() - settings.timeWindow * 60 * 60 * 1000)
    )} to ${formatDate(new Date())}</p>
  `
}
