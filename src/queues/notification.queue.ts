import Queue from "bull"
import { PrismaClient, RedditPost, Preferences } from "@prisma/client"
import nodemailer from "nodemailer"
import { formatDistanceToNow } from "date-fns"

const prisma = new PrismaClient()

// Combined notification queue
export const notificationQueue = new Queue("notifications", {
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false,
  },
})

interface NotificationData {
  userId?: string
  orgId?: string
}

interface NotificationJobId {
  userId?: string
  orgId?: string
}

// Email configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
})

// Process notifications
notificationQueue.process(async (job) => {
  const { userId, orgId } = job.data as NotificationData

  // Get user preferences
  const preferences = await prisma.preferences.findFirst({
    where: {
      ...(userId ? { userId } : { orgId }),
      enabled: true,
    },
  })

  if (!preferences || !preferences.emails.length) {
    return
  }

  const timeWindowHours = preferences.timeWindow
  const currentTime = new Date()
  const windowStart = new Date(
    currentTime.getTime() - timeWindowHours * 60 * 60 * 1000
  )

  // Get posts within time window
  const posts = await prisma.redditPost.findMany({
    where: {
      ...(userId ? { userId } : { orgId }),
      createdUtc: {
        gte: BigInt(Math.floor(windowStart.getTime() / 1000)),
      },
    },
    include: {
      comments: true,
    },
    orderBy: {
      numComments: "desc",
    },
  })

  // Check thresholds
  const shouldNotify = checkThresholds(posts, preferences)

  if (!shouldNotify) {
    return
  }

  // Send email notification
  await sendNotificationEmail(posts, preferences)

  // Update notification history
  await prisma.notificationHistory.create({
    data: {
      userId,
      orgId,
      postIds: posts.map((p) => p.id),
      category: "all",
      issueCount: posts.length,
      emailsSentTo: preferences.emails,
    },
  })

  // Update last notified timestamp
  await prisma.preferences.update({
    where: { id: preferences.id },
    data: { lastNotified: currentTime },
  })
})

function checkThresholds(
  posts: RedditPost[],
  preferences: Preferences
): boolean {
  // Group posts by category
  const postsByCategory = posts.reduce((acc, post) => {
    const category = post.category || "uncategorized"
    if (!acc[category]) {
      acc[category] = []
    }
    acc[category].push(post)
    return acc
  }, {} as Record<string, RedditPost[]>)

  // Check thresholds for each category
  for (const [category, categoryPosts] of Object.entries(postsByCategory)) {
    // Volume threshold per category
    const volumeExceeded = categoryPosts.length >= preferences.issueThreshold

    // Sentiment threshold per category
    const avgSentiment =
      categoryPosts.reduce((sum, post) => sum + (post.sentimentScore || 0), 0) /
      categoryPosts.length
    const sentimentExceeded = avgSentiment <= preferences.sentimentThreshold

    // Comment growth threshold per category
    const totalComments = categoryPosts.reduce(
      (sum, post) => sum + post.numComments,
      0
    )
    const commentGrowthExceeded =
      totalComments >= preferences.commentGrowthThreshold

    // If any category exceeds thresholds, return true
    if (volumeExceeded || sentimentExceeded || commentGrowthExceeded) {
      return true
    }
  }

  return false
}

async function sendNotificationEmail(
  posts: RedditPost[],
  preferences: Preferences
) {
  // Group posts by category and exclude "Noise"
  const postsByCategory = posts.reduce((acc, post) => {
    const category = post.category || "uncategorized"
    if (category.toLowerCase() === "noise") return acc

    if (!acc[category]) {
      acc[category] = []
    }
    acc[category].push(post)
    return acc
  }, {} as Record<string, RedditPost[]>)

  // Calculate category stats
  const categoryStats = Object.entries(postsByCategory)
    .map(([category, posts]) => ({
      category,
      postCount: posts.length,
      commentCount: posts.reduce((sum, post) => sum + post.numComments, 0),
      avgSentiment:
        posts.reduce((sum, post) => sum + (post.sentimentScore || 0), 0) /
        posts.length,
      trending: posts.length >= preferences.issueThreshold,
    }))
    .sort((a, b) => b.postCount - a.postCount)

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #2c3e50; border-bottom: 2px solid #eee; padding-bottom: 10px;">
        Community Activity Alert
      </h1>
      
      <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <h2 style="color: #2c3e50; margin-top: 0;">Latest Activity Summary</h2>
        <p>Time Window: Last ${preferences.timeWindow} hours</p>
        <p>Categories Found: ${Object.keys(postsByCategory).length}</p>
        <p>Total Posts: ${posts.length}</p>
      </div>

      ${categoryStats
        .map(
          (stat) => `
        <div style="margin-top: 30px;">
          <h3 style="color: #2c3e50; display: flex; align-items: center;">
            ${stat.category} 
            ${
              stat.trending
                ? `<span style="margin-left: 10px; font-size: 12px; background: #ff6b6b; color: white; padding: 3px 8px; border-radius: 12px;">
                Trending
              </span>`
                : ""
            }
          </h3>
          <div style="background: #f8f9fa; padding: 10px; border-radius: 5px; margin: 10px 0;">
            <p style="margin: 5px 0; font-size: 14px;">Posts: ${
              stat.postCount
            }</p>
            <p style="margin: 5px 0; font-size: 14px;">Comments: ${
              stat.commentCount
            }</p>
            <p style="margin: 5px 0; font-size: 14px;">Sentiment: ${stat.avgSentiment.toFixed(
              2
            )}</p>
          </div>
          ${postsByCategory[stat.category]
            .slice(0, 3)
            .map(
              (post) => `
            <div style="border: 1px solid #eee; padding: 15px; margin: 10px 0; border-radius: 5px;">
              <h4 style="margin: 0; color: #2c3e50;">${post.title}</h4>
              <p style="color: #666; font-size: 14px;">
                ${post.numComments} comments · Posted ${formatDistanceToNow(
                new Date(Number(post.createdUtc) * 1000)
              )} ago
                · Sentiment: ${post.sentimentScore?.toFixed(2) || "N/A"}
              </p>
              <p style="margin: 10px 0;">${post.content.slice(0, 150)}...</p>
              ${
                post.permalink
                  ? `<a href="https://reddit.com${post.permalink}" 
                    style="background: #0066cc; color: white; padding: 5px 10px; text-decoration: none; border-radius: 3px;">
                  View Discussion
                </a>`
                  : ""
              }
            </div>
          `
            )
            .join("")}
        </div>
      `
        )
        .join("")}
    </div>
  `

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: preferences.emails,
    subject: `Community Activity Alert - Category Insights - ${new Date().toLocaleDateString()}`,
    html,
  })
}

async function getNotificationJobKey(
  targetId: string,
  isOrg: boolean
): Promise<string> {
  return `notifications:${isOrg ? "org" : "user"}:${targetId}`
}

export async function manageNotifications(
  targetId: string,
  isOrg: boolean,
  enable: boolean
) {
  try {
    const preferences = await prisma.preferences.findFirst({
      where: isOrg ? { orgId: targetId } : { userId: targetId },
    })

    if (!preferences) {
      throw new Error("Preferences not found")
    }

    // Update preferences
    await prisma.preferences.update({
      where: { id: preferences.id },
      data: { ingestionActive: enable },
    })

    const jobKey = await getNotificationJobKey(targetId, isOrg)

    if (enable) {
      // Schedule new notification job
      await notificationQueue.add(
        {
          userId: isOrg ? undefined : targetId,
          orgId: isOrg ? targetId : undefined,
        },
        {
          jobId: jobKey,
          repeat: {
            every: preferences.timeWindow * 60 * 60 * 1000,
          },
        }
      )
      console.log(
        `Notifications enabled for ${isOrg ? "org" : "user"}: ${targetId}`
      )
    } else {
      // Remove existing jobs
      const repeatable = await notificationQueue.getRepeatableJobs()
      const job = repeatable.find((j) => j.key.includes(jobKey))

      if (job) {
        await notificationQueue.removeRepeatableByKey(job.key)
        console.log(
          `Notifications disabled for ${isOrg ? "org" : "user"}: ${targetId}`
        )
      }
    }
  } catch (error) {
    console.error("Error managing notifications:", error)
    throw new Error(`Failed to ${enable ? "enable" : "disable"} notifications`)
  }
}

// Replace the existing scheduleNotifications function with these convenience methods
export async function enableNotifications(targetId: string, isOrg: boolean) {
  return manageNotifications(targetId, isOrg, true)
}

export async function disableNotifications(targetId: string, isOrg: boolean) {
  return manageNotifications(targetId, isOrg, false)
}
