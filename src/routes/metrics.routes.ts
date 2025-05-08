import { Router } from "express"
import { z } from "zod"
import prisma from "../utils/prismaClient"
import { ResponseUtils } from "../utils/response.utils"
import type { Request } from "express"
import {
  CalculateEngagementScore,
  GetSentimentDistribution,
} from "../utils/metrics"
import { RedditPost } from "@prisma/client"
import * as sw from "stopword"
import analyzeFeedback from "../utils/wordFrequency"

const router = Router()

interface MetricResponse {
  topCategories: Array<{
    category: string
    count: number
    previousCount: number
    percentageChange: number
    percentageOfTotal: number
    topIssues: Array<{
      title: string
      commentCount: number
      url: string | null
      createdAt: string
      category: string
    }>
  }>
  windowComparison: {
    currentWindowPosts: number
    previousWindowPosts: number
    percentageChange: number
    currentWindowStartDate: string
    previousWindowStartDate: string
  }
  topPosts: Array<{
    title: string
    commentCount: number
    url: string | null
    createdAt: string
    category: string
  }>
}

// Query schema with proper validation
const MetricsQuerySchema = z.object({
  userId: z.string().optional(),
  orgId: z.string().optional(),
  timeWindow: z.union([z.coerce.number(), z.string()]).default(24),
  product: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sentimentCategory: z.string().optional(),
})

/**
 * Get Community Metrics
 * Endpoint: GET /metrics
 */
router.get("/", async (req: Request, res) => {
  try {
    const result = MetricsQuerySchema.safeParse(req.query)

    if (!result.success) {
      return ResponseUtils.error(
        res,
        result.error.errors[0].message,
        400,
        "VALIDATION_ERROR"
      )
    }

    const params = result.data

    console.log(params, "params")

    // Validate user/org context
    if (!params.userId && !params.orgId) {
      return ResponseUtils.error(
        res,
        "Either userId or orgId is required",
        400,
        "VALIDATION_ERROR"
      )
    }

    // Get the latest window metrics
    const latestMetrics = await prisma.windowMetrics.findFirst({
      where: {
        ...(params.orgId ? { orgId: params.orgId } : { userId: params.userId }),
      },
      orderBy: {
        timestamp: "desc",
      },
    })

    if (!latestMetrics) {
      return ResponseUtils.error(res, "No metrics found", 404, "NOT_FOUND")
    }

    // Get posts since the last window
    const currentPosts = await prisma.redditPost.findMany({
      where: {
        ...(params.orgId ? { orgId: params.orgId } : { userId: params.userId }),
        createdUtc: {
          gte: BigInt(Math.floor(latestMetrics.timestamp.getTime() / 1000)), // Convert timestamp to Unix seconds
        },
      },
      orderBy: {
        numComments: "desc",
      },
      include: {
        comments: true, // Include comments to get accurate comment counts
      },
    })

    console.log("Current window data:", {
      latestMetricsTimestamp: latestMetrics.timestamp.toISOString(),
      newPostsCount: currentPosts.length,
    })

    // Parse the stored category trends
    const previousTrends = latestMetrics.categoryTrends
      ? (JSON.parse(latestMetrics.categoryTrends.toString()) as Array<{
          category: string
          currentCount: number
          posts: Array<{
            id: string
            title: string
            numComments: number
            category: string
            createdUtc: number
            lastUpdated: number
            permalink: string | null
          }>
        }>)
      : []

    // Calculate current trends since last window
    const currentTrends = new Map<string, { count: number; posts: any[] }>()
    currentPosts.forEach((post) => {
      const category = post.category || "Unknown"
      if (!currentTrends.has(category)) {
        currentTrends.set(category, { count: 0, posts: [] })
      }
      const trend = currentTrends.get(category)!
      trend.count++
      trend.posts.push({
        id: post.id,
        title: post.title,
        numComments: post.numComments,
        createdUtc: Number(post.createdUtc),
        lastUpdated: Number(post.lastUpdated),
        category: post.category || "Unknown",
        permalink: post.permalink,
      })
    })

    console.log("Trends comparison:", {
      previous: previousTrends.map((t) => ({
        category: t.category,
        count: t.currentCount,
      })),
      current: Array.from(currentTrends.entries()).map(([category, data]) => ({
        category,
        count: data.count,
      })),
    })

    const getPreviousWindowStart = (currentTime: number, timeWindow: string | number): number => {
      if (typeof timeWindow === 'number') {
        return currentTime - timeWindow * 60 * 60 * 1000;
      }
      const now = new Date(currentTime);
      switch (timeWindow) {
        case 'last_3_months':
          return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).getTime();
        case 'last_6_months':
          return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()).getTime();
        case 'last_year':
          return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).getTime();
        case 'ytd':
          return new Date(now.getFullYear(), 0, 1).getTime();
        case 'all_time':
          return new Date(now.getFullYear() - 10, 0, 1).getTime();
        default:
          return currentTime - 24 * 60 * 60 * 1000; // Default to 24 hours
      }
    };

    const response: MetricResponse = {
      topCategories: previousTrends
        .map((trend) => {
          const current = currentTrends.get(trend.category) || {
            count: 0,
            posts: [],
          }
          const totalCount = trend.currentCount + current.count
          const allPosts = [...current.posts, ...trend.posts]

          return {
            category: trend.category,
            count: totalCount,
            previousCount: trend.currentCount, // Previous window's count from stored metrics
            percentageChange:
              trend.currentCount > 0
                ? Number(
                    (
                      ((totalCount - trend.currentCount) / trend.currentCount) *
                      100
                    ).toFixed(2)
                  )
                : 0,
            percentageOfTotal: Number(
              (
                (totalCount /
                  (latestMetrics.totalPosts + currentPosts.length)) *
                100
              ).toFixed(2)
            ),
            topIssues: allPosts
              .sort((a, b) => b.numComments - a.numComments)
              .map((post) => ({
                title: post.title,
                commentCount: post.numComments,
                url: post.permalink
                  ? `https://reddit.com${post.permalink}`
                  : `https://reddit.com/comments/${post.id}`,
                createdAt: new Date(post.createdUtc * 1000).toISOString(),
                category: post.category || "Unknown",
              })),
          }
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      windowComparison: {
        currentWindowPosts: latestMetrics.totalPosts + currentPosts.length,
        previousWindowPosts: latestMetrics.totalPosts,
        percentageChange:
          latestMetrics.totalPosts > 0
            ? Number(
                (
                  ((latestMetrics.totalPosts +
                    currentPosts.length -
                    latestMetrics.totalPosts) /
                    latestMetrics.totalPosts) *
                  100
                ).toFixed(2)
              )
            : 0,
        currentWindowStartDate: latestMetrics.timestamp.toISOString(),
        previousWindowStartDate: new Date(
          getPreviousWindowStart(latestMetrics.timestamp.getTime(), params.timeWindow)
        ).toISOString(),
      },
      topPosts: [...currentPosts]
        .sort((a, b) => b.numComments - a.numComments)
        .map((post) => ({
          title: post.title,
          commentCount: post.numComments,
          url: post.permalink
            ? `https://reddit.com${post.permalink}`
            : `https://reddit.com/comments/${post.id}`,
          createdAt: new Date(Number(post.createdUtc) * 1000).toISOString(),
          category: post.category || "Unknown",
        })),
    }

    return ResponseUtils.success(res, response)
  } catch (error) {
    console.error("Error fetching metrics:", error)
    return ResponseUtils.error(
      res,
      "Failed to fetch metrics",
      500,
      "FETCH_METRICS_ERROR",
      error instanceof Error ? error.message : String(error)
    )
  }
})

// Get time window setting for an organization
router.get("/time-window", async (req, res) => {
  try {
    const orgId = req.query.orgId as string

    if (!orgId) {
      res.status(400).json({ error: "orgId is required" })
      return
    }

    const settings = await prisma.preferences.findFirst({
      where: { orgId },
      select: { timeWindow: true },
    })

    res.json({ timeWindow: settings?.timeWindow || 24 })
  } catch (error) {
    console.error("Error fetching time window:", error)
    res.status(500).json({ error: "Failed to fetch time window setting" })
  }
})

// Helper function to group posts by time period and then by category
function groupPostsByTimeAndCategory(posts: any[], startDate: Date, endDate: Date) {
  if (!posts.length) return {};

  console.log(`Grouping ${posts.length} posts from ${startDate.toISOString()} to ${endDate.toISOString()}`);

  // Count total occurrences per category
  const categoryTotals: Record<string, number> = {};
  posts.forEach(post => {
    const cat = post.category || 'Unknown';
    categoryTotals[cat] = (categoryTotals[cat] || 0) + 1;
  });

  console.log("Category totals:", categoryTotals);

  // Get all unique categories, sorted by total count descending
  const allCategories = Object.keys(categoryTotals).sort((a, b) => categoryTotals[b] - categoryTotals[a]);

  // Build a list of all days in the range
  const days: string[] = [];
  let d = new Date(startDate);
  d.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999); // Ensure end of day is included
  while (d <= end) {
    days.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }

  console.log(`Generated ${days.length} days in the range`);

  // Initialize result with all days and all categories set to 0
  const result: Record<string, Record<string, number>> = {};
  for (const day of days) {
    result[day] = {};
    for (const cat of allCategories) {
      result[day][cat] = 0;
    }
  }

  // Fill in actual counts
  posts.forEach(post => {
    const date = new Date(Number(post.createdUtc) * 1000);
    const day = date.toISOString().slice(0, 10);
    const category = post.category || 'Unknown';
    if (result[day] && category in result[day]) {
      result[day][category] += 1;
    }
  });

  // Check if we have any non-zero values
  let hasData = false;
  for (const day in result) {
    for (const cat in result[day]) {
      if (result[day][cat] > 0) {
        hasData = true;
        break;
      }
    }
    if (hasData) break;
  }

  console.log(`Category trends grid has ${Object.keys(result).length} days, ${allCategories.length} categories, hasData: ${hasData}`);
  
  return result;
}

/**
 * Get Community Metrics
 * Endpoint: GET /metrics/new
 */
router.get("/new", async (req, res) => {
  const result = MetricsQuerySchema.safeParse(req.query)
  if (!result.success) {
    return ResponseUtils.error(
      res,
      result.error.errors[0].message,
      400,
      "VALIDATION_ERROR"
    )
  }

  const {
    userId,
    orgId,
    timeWindow,
    product,
    dateFrom,
    dateTo,
    sentimentCategory,
  } = result.data

  // Calculate window dates based on custom date range or default timeWindow
  const currentWindowStart = dateFrom
    ? new Date(dateFrom).getTime()
    : (() => {
        const now = new Date();
        if (typeof timeWindow === 'number') {
          return now.getTime() - timeWindow * 60 * 60 * 1000;
        }
        switch (timeWindow) {
          case 'last_3_months':
            return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).getTime();
          case 'last_6_months':
            return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()).getTime();
          case 'last_year':
            return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).getTime();
          case 'ytd':
            return new Date(now.getFullYear(), 0, 1).getTime();
          case 'all_time':
            return new Date(now.getFullYear() - 10, 0, 1).getTime(); // Default to 10 years ago
          default:
            return now.getTime() - 24 * 60 * 60 * 1000; // Fallback to 24 hours
        }
      })();

  const previousWindowStart = dateFrom
    ? new Date(dateFrom).getTime() - (typeof timeWindow === 'number' ? timeWindow : 24) * 60 * 60 * 1000
    : (() => {
        const now = new Date();
        if (typeof timeWindow === 'number') {
          return now.getTime() - timeWindow * 60 * 60 * 1000;
        }
        switch (timeWindow) {
          case 'last_3_months':
            return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()).getTime();
          case 'last_6_months':
            return new Date(now.getFullYear(), now.getMonth() - 12, now.getDate()).getTime();
          case 'last_year':
            return new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()).getTime();
          case 'ytd':
            return new Date(now.getFullYear() - 1, 0, 1).getTime();
          case 'all_time':
            return new Date(now.getFullYear() - 20, 0, 1).getTime(); // Default to 20 years ago
          default:
            return now.getTime() - 24 * 60 * 60 * 1000; // Fallback to 24 hours
        }
      })();

  const currentWindowEnd = dateTo
    ? new Date(dateTo).getTime()
    : new Date().getTime()

  const formatDateTime = (date: Date) => {
    return date.toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
  }

  const currentWindowStartReadable = formatDateTime(
    new Date(currentWindowStart)
  )
  const previousWindowStartReadable = formatDateTime(
    new Date(previousWindowStart)
  )

  const currentWindowWhere = {
    ...(orgId ? { orgId } : { userId }),
    createdUtc: {
      gte: BigInt(Math.floor(currentWindowStart / 1000)),
      ...(dateTo && { lt: BigInt(Math.floor(currentWindowEnd / 1000)) }),
    },
    ...(product ? { product } : {}),
    ...(sentimentCategory ? { sentimentCategory } : {}),
  }
  const currentWindowPostsFromDb = await prisma.redditPost.findMany({
    where: currentWindowWhere,
    orderBy: {
      numComments: "desc",
    },
    include: {
      comments: true,
    },
  })

  const previousWindowWhere = {
    ...(orgId ? { orgId } : { userId }),
    createdUtc: {
      gte: BigInt(Math.floor(previousWindowStart / 1000)),
      lt: BigInt(Math.floor(currentWindowStart / 1000)),
    },
    ...(product ? { product } : {}),
    ...(sentimentCategory ? { sentimentCategory } : {}),
  }
  const previousWindowPostsFromDb = await prisma.redditPost.findMany({
    where: previousWindowWhere,
    orderBy: {
      numComments: "desc",
    },
    include: {
      comments: true,
    },
  })
  const currentWindowPostsCount = currentWindowPostsFromDb.length
  const previousWindowPostsCount = previousWindowPostsFromDb.length

  const top5CategoriesInCurrentWindowWithTop5Posts =
    currentWindowPostsFromDb.reduce((acc, post) => {
      if (!post.category) return acc

      if (!acc.has(post.category)) {
        acc.set(post.category, {
          count: 0,
          posts: [],
        })
      }

      const category = acc.get(post.category)!
      category.count++
      category.posts.push({
        title: post.title,
        commentCount: post.numComments,
        score: post.score,
        url: post.permalink
          ? `https://reddit.com${post.permalink}`
          : `https://reddit.com/comments/${post.id}`,
        createdAt: new Date(Number(post.createdUtc) * 1000).toISOString(),
        category: post.category || "Unknown",
        sentimenScore: post.sentimentScore,
        sentimentCategory: post.sentimentCategory,
      })

      return acc
    }, new Map<string, { count: number; posts: any[] }>())

  const top5CategoriesInPreviousWindowWithTop5Posts =
    previousWindowPostsFromDb.reduce((acc, post) => {
      if (!post.category) return acc

      if (!acc.has(post.category)) {
        acc.set(post.category, {
          count: 0,
          posts: [],
        })
      }

      const category = acc.get(post.category)!
      category.count++
      category.posts.push({
        title: post.title,
        commentCount: post.numComments,
        score: post.score,
        url: post.permalink
          ? `https://reddit.com${post.permalink}`
          : `https://reddit.com/comments/${post.id}`,
        createdAt: new Date(Number(post.createdUtc) * 1000).toISOString(),
        category: post.category || "Unknown",
        sentimenScore: post.sentimentScore,
        sentimentCategory: post.sentimentCategory,
      })

      return acc
    }, new Map<string, { count: number; posts: any[] }>())

  const top10MostEngagingPostsInCurrentWindow = currentWindowPostsFromDb
    .sort((a, b) => b.score + b.numComments - (a.score + a.numComments))
    .slice(0, 10)
    .map((post) => ({
      title: post.title,
      commentCount: post.numComments,
      score: post.score,
      url: post.permalink
        ? `https://reddit.com${post.permalink}`
        : `https://reddit.com/comments/${post.id}`,
      createdAt: new Date(Number(post.createdUtc) * 1000).toISOString(),
      category: post.category || "Unknown",
      sentimenScore: post.sentimentScore,
      sentimentCategory: post.sentimentCategory,
    }))

  const top10MostEngagingPostsInPreviousWindow = previousWindowPostsFromDb
    .sort((a, b) => b.score + b.numComments - (a.score + a.numComments))
    .slice(0, 10)
    .map((post) => ({
      title: post.title,
      commentCount: post.numComments,
      score: post.score,
      url: post.permalink
        ? `https://reddit.com${post.permalink}`
        : `https://reddit.com/comments/${post.id}`,
      createdAt: new Date(Number(post.createdUtc) * 1000).toISOString(),
      category: post.category || "Unknown",
      sentimenScore: post.sentimentScore,
      sentimentCategory: post.sentimentCategory,
    }))

  /**
   * Enhanced word frequency analyzer for identifying user pain points in feedback
   *
   * Features:
   * - Identifies meaningful phrases/bigrams, not just single words
   * - Categorizes words by sentiment and importance
   * - Filters technical noise and common language patterns
   * - Adaptable to different domains through customization options
   */

  const postsForFeedback = currentWindowPostsFromDb.map((post) => ({
    ...post,
    comments: post.comments.map((comment) => comment.content),
  }))
  const feedbackAnalysis = analyzeFeedback(postsForFeedback, {
    minFrequency: 2,
  })

  // Calculate category trends over time
  const startDate = new Date(currentWindowStart);
  const endDate = new Date(currentWindowEnd);
  
  console.log("API Debug - Date range:", {
    currentWindowStart,
    currentWindowEnd,
    startDateIso: startDate.toISOString(),
    endDateIso: endDate.toISOString(),
    totalPosts: currentWindowPostsFromDb.length
  });
  
  const categoryTrends = groupPostsByTimeAndCategory(currentWindowPostsFromDb, startDate, endDate);

  // Prepare the response
  const response = {
    currentWindow: {
      startTime: String(currentWindowStart),
      readableStartTime: currentWindowStartReadable,
      postCount: currentWindowPostsCount,
      engagementScore: CalculateEngagementScore(currentWindowPostsFromDb),
      sentimentDistribution: GetSentimentDistribution(currentWindowPostsFromDb),
      topCategories: Array.from(top5CategoriesInCurrentWindowWithTop5Posts)
        .filter(([category]) => category !== "Noise")
        .sort((a, b) => b[1].count - a[1].count)
        .map(([category, data]) => {
          const previousData = top5CategoriesInPreviousWindowWithTop5Posts.get(category) || { count: 0 };
          const percentageChange = previousData.count === 0 ? 100 : ((data.count - previousData.count) / previousData.count) * 100;
          return {
            category,
            count: data.count,
            previousCount: previousData.count,
            percentageChange,
            percentageOfTotal: (data.count / currentWindowPostsCount) * 100,
            topIssues: data.posts.sort((a, b) => b.commentCount - a.commentCount),
          };
        }),
      topPosts: top10MostEngagingPostsInCurrentWindow,
      feedbackAnalysis: feedbackAnalysis,
      categoryTrends: categoryTrends
    },
    previousWindow: {
      startTime: String(previousWindowStart),
      readableStartTime: previousWindowStartReadable,
      postCount: previousWindowPostsCount,
      engagementScore: CalculateEngagementScore(previousWindowPostsFromDb),
      sentimentDistribution: GetSentimentDistribution(previousWindowPostsFromDb),
      topCategories: Array.from(top5CategoriesInPreviousWindowWithTop5Posts)
        .filter(([category]) => category !== "Noise")
        .sort((a, b) => b[1].count - a[1].count)
        .map(([category, data]) => ({
          category,
          count: data.count,
          topIssues: data.posts.sort((a, b) => b.commentCount - a.commentCount),
        })),
      topPosts: top10MostEngagingPostsInPreviousWindow,
    },
  };

  ResponseUtils.success(res, response);
})

export default router
