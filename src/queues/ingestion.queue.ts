import dotenv from "dotenv"
dotenv.config()
import Snoowrap from "snoowrap"
import Queue from "bull"
import { REDIS_CONFIG } from "../config/redis"
import prisma from "../utils/prismaClient"
import { SubReddit } from "@prisma/client"

// Define TypeScript interfaces for clarity
interface RedditPostData {
  id: string
  title: string
  selftext: string
  author: {
    name: string
    icon_img: string | null
  }
  thumbnail: string | null
  url: string
  permalink: string
  created_utc: number
  score: number
  num_comments: number
}

interface RedditCommentData {
  id: string
  parent_id: string | null
  author: {
    name: string
  }
  body: string
  created_utc: number
  score: number
  replies: Snoowrap.Comment[]
}

// Initialize Snoowrap with credentials from environment variables
const r = new Snoowrap({
  userAgent: process.env.REDDIT_USER_AGENT!,
  clientId: process.env.REDDIT_CLIENT_ID!,
  clientSecret: process.env.REDDIT_CLIENT_SECRET!,
  username: process.env.REDDIT_USERNAME!,
  password: process.env.REDDIT_PASSWORD!,
})

// Initialize Bull queue
export const ingestionQueue = new Queue("ingestion-queue", {
  redis: REDIS_CONFIG,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: true,
  },
})

// Utility function to check if a URL is an image
const isImageUrl = (url: string): boolean => {
  return /\.(jpg|jpeg|png|gif)$/.test(url)
}

// Utility function to sanitize `authorProfilePhoto`
const sanitizeAuthorProfilePhoto = (iconImg: any): string | null => {
  if (typeof iconImg === "string") {
    return iconImg
  } else if (typeof iconImg === "object" && iconImg !== null && iconImg.url) {
    return iconImg.url
  }
  return null
}

// Utility function to delay execution (rate limiting)
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Function to process comments
const processComments = async (
  postId: string,
  comments: Snoowrap.Comment[],
  userId: string,
  orgId: string | null
): Promise<void> => {
  // Explicit return type
  for (const comment of comments) {
    const commentData: RedditCommentData = {
      id: comment.id,
      parent_id: comment.parent_id.startsWith("t1_")
        ? comment.parent_id.substring(3)
        : null,
      author: {
        name: comment.author.name,
      },
      body: comment.body,
      created_utc: comment.created_utc,
      score: comment.score,
      replies: comment.replies, // Snoowrap already fetches replies recursively
    }

    try {
      await prisma.redditComment.upsert({
        where: { id: commentData.id },
        update: {
          score: commentData.score,
          lastUpdated: BigInt(Math.floor(Date.now() / 1000)),
        },
        create: {
          id: commentData.id,
          postId: postId,
          parentCommentId: commentData.parent_id,
          author: commentData.author.name,
          content: commentData.body,
          createdUtc: BigInt(commentData.created_utc),
          score: commentData.score,
          lastUpdated: BigInt(Math.floor(Date.now() / 1000)),
        },
      })
      console.log(`✅ Comment saved/updated: ${commentData.id}`)

      // If the comment has replies, process them recursively
      if (commentData.replies && commentData.replies.length > 0) {
        await processComments(postId, commentData.replies, userId, orgId)
      }
    } catch (error) {
      console.error(
        `❌ Error saving/updating comment ${commentData.id}:`,
        error
      )
    }

    // Respect Reddit's API rate limits
    await delay(5000) // 1-second delay between processing comments
  }
}

// Function to save and process post
const saveAndProcessPost = async (
  post: RedditPostData,
  userId: string,
  orgId: string | null
): Promise<void> => {
  // Explicit return type
  try {
    await prisma.redditPost.upsert({
      where: { id: post.id },
      update: {
        title: post.title,
        content: post.selftext || "",
        author: post.author.name,
        authorProfilePhoto: sanitizeAuthorProfilePhoto(post.author.icon_img),
        thumbnail: post.thumbnail || null,
        imageUrl: isImageUrl(post.url) ? post.url : null,
        permalink: post.permalink,
        createdUtc: BigInt(post.created_utc),
        score: post.score,
        numComments: post.num_comments,
        lastUpdated: BigInt(Math.floor(Date.now() / 1000)),
        needsProcessing: true,
        processingPriority: 0,
        sentimentScore: null,
        sentimentCategory: null,
        category: null,
        product: null,
        sameIssuesCount: 0,
        sameDeviceCount: 0,
        solutionsCount: 0,
        updateIssueMention: 0,
        updateResolvedMention: 0,
        userId: userId,
        orgId: orgId,
      },
      create: {
        id: post.id,
        title: post.title,
        content: post.selftext || "",
        author: post.author.name,
        authorProfilePhoto: sanitizeAuthorProfilePhoto(post.author.icon_img),
        thumbnail: post.thumbnail || null,
        imageUrl: isImageUrl(post.url) ? post.url : null,
        permalink: post.permalink,
        createdUtc: BigInt(post.created_utc),
        score: post.score,
        numComments: post.num_comments,
        lastUpdated: BigInt(Math.floor(Date.now() / 1000)),
        needsProcessing: true,
        processingPriority: 0,
        sentimentCategory: null,
        sentimentScore: null,
        category: null,
        product: null,
        sameIssuesCount: 0,
        sameDeviceCount: 0,
        solutionsCount: 0,
        updateIssueMention: 0,
        updateResolvedMention: 0,
        userId: userId,
        orgId: orgId,
      },
    })
    console.log(`✅ Post saved: ${post.title}`)

    // Fetch and process comments for the post
    await r
      .getSubmission(post.id)
      .fetch()
      .then(async (submission: any) => {
        const comments = await submission.comments.fetchAll({ limit: 100 })
        await processComments(post.id, comments, userId, orgId)
      })
  } catch (error) {
    console.error(`❌ Error processing post ${post.id}:`, error)
    throw error // Ensure the job fails to trigger the 'failed' event
  }

  // Respect Reddit's API rate limits
  await delay(3000) // 1-second delay between processing posts
}

// Function to fetch posts from subreddits
const getPostsFromSubReddits = async (subReddits: SubReddit[]) => {
  const results: RedditPostData[][] = []
  for (const subReddit of subReddits) {
    console.log(`📥 Fetching posts from r/${subReddit.name}...`)
    const startTime = Date.now()

    try {
      const subreddit = r.getSubreddit(subReddit.name)
      let posts: any[] = []

      if (subReddit.keywords && subReddit.keywords.length > 0) {
        const searchQuery = subReddit.keywords.join(" OR ")
        console.log(
          `🔍 Searching r/${subReddit.name} with query: ${searchQuery}`
        )

        posts = await subreddit.search({
          query: searchQuery,
          sort: "new",
          time: "day",
          limit: 100,
        } as any)
      } else {
        console.log(`📥 Fetching latest posts from r/${subReddit.name}`)
        posts = await subreddit.getNew({ limit: 100 })
      }

      const duration = Date.now() - startTime

      // Filter and map posts with careful error handling
      const mappedPosts = await Promise.all(
        posts.map(async (post: any) => {
          try {
            if (!post || !post.id) {
              console.log(`⚠️ Skipping invalid post`)
              return null
            }

            let authorName = "[deleted]"
            let authorIconImg = null

            if (post.author) {
              try {
                authorName = post.author.name || "[deleted]"
                authorIconImg = post.author.icon_img || null
              } catch (authorError) {
                console.log(
                  `⚠️ Cannot access author for post ${post.id}, using default values`
                )
              }
            }

            const redditPost: RedditPostData = {
              id: post.id,
              title: post.title || "",
              selftext: post.selftext || "",
              author: {
                name: authorName,
                icon_img: authorIconImg,
              },
              thumbnail: post.thumbnail || null,
              url: post.url || "",
              permalink: post.permalink || "",
              created_utc: post.created_utc || Math.floor(Date.now() / 1000),
              score: post.score || 0,
              num_comments: post.num_comments || 0,
            }

            return redditPost
          } catch (postError) {
            console.error(
              `❌ Error mapping post ${post?.id || "unknown"}:`,
              postError
            )
            return null
          }
        })
      )

      // Filter out null values and explicitly type as RedditPostData[]
      const validPosts = mappedPosts.filter(
        (post): post is RedditPostData => post !== null
      )
      results.push(validPosts)

      console.log(`
       ✓ r/${subReddit.name}:
         Posts fetched: ${validPosts.length}
         Duration: ${duration}ms
      `)
    } catch (error) {
      console.error(`❌ Error fetching posts from r/${subReddit.name}:`, error)
      results.push([])
    }

    await delay(2000)
  }
  return results
}

// Define the job processor
ingestionQueue.process(async (job) => {
  if (!job || !job.data) {
    console.error("Invalid job received:", job)
    return
  }

  const { userId, orgId, subReddits } = job.data

  try {
    console.log(`🔄 Starting ingestion for user: ${userId}, org: ${orgId}`)
    console.log(
      `📊 Processing subreddits: ${subReddits
        .map((subreddit: SubReddit) => subreddit.name)
        .join(", ")}`
    )

    // Fetch posts from all subreddits
    const allPosts = await getPostsFromSubReddits(subReddits)

    // Process each batch of posts
    for (const posts of allPosts) {
      for (const post of posts) {
        await saveAndProcessPost(post, userId, orgId)
      }
    }

    console.log(`✅ Ingestion completed for user: ${userId}, org: ${orgId}`)
    return { success: true }
  } catch (error) {
    console.error("Error processing ingestion job:", error)
    throw error
  }
})

// Handle job completion
ingestionQueue.on("completed", (job, result) => {
  const { userId, orgId } = job.data
  console.log(`✅ Job completed for user: ${userId}, org: ${orgId}`)
})

// Handle job failure
ingestionQueue.on("failed", async (job, error) => {
  if (!job?.data) {
    console.error("Failed job with no data:", error)
    return
  }

  const { userId, orgId } = job.data
  console.error(
    `🚨 Job failed for user: ${userId}, org: ${orgId}. Error: ${error}`
  )

  // Update ingestionActive to false on failure
  try {
    await prisma.preferences.updateMany({
      where: {
        userId,
        orgId: orgId || null,
      },
      data: {
        ingestionActive: false,
      },
    })
    console.log(
      `⚠️ ingestionActive set to false for user: ${userId}, org: ${orgId}`
    )
  } catch (updateError) {
    console.error(
      "❌ Failed to update ingestion status to false after job failure:",
      updateError
    )
  }
})

// Function to start ingestion with repeatable jobs
export const startIngestion = async (data: {
  userId: string | null
  orgId: string | null
  activeSubreddits: SubReddit[]
  cronSchedule: string
}) => {
  console.log(`
📋 Scheduling new ingestion:
   User ID: ${data.userId}
   Organization ID: ${data.orgId}
   Subreddits: ${data.activeSubreddits
     .map((subreddit) => subreddit.name)
     .join(", ")}
   Schedule: ${data.cronSchedule}
`)

  await ingestionQueue.add(
    {
      userId: data.userId,
      orgId: data.orgId,
      subReddits: data.activeSubreddits,
    },
    {
      repeat: {
        cron: data.cronSchedule,
      },
      jobId: `ingestion-${data.orgId || "no-org"}-${data.userId}`,
    }
  )

  console.log(`✨ Ingestion scheduled successfully for user: ${data.userId}`)
}
