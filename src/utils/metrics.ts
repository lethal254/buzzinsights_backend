import { RedditPost } from "@prisma/client"

export function CalculateEngagementScore(posts: RedditPost[]): number {
  const totalUpvotes = posts.reduce((sum, post) => sum + post.score, 0)
  const totalComments = posts.reduce((sum, post) => sum + post.numComments, 0)
  const totalPosts = posts.length

  if (totalPosts === 0) return 0

  const normalizedEngagementScore =
    (totalUpvotes * 0.5 + totalComments * 1) / totalPosts
  return normalizedEngagementScore
}

export function GetSentimentDistribution(
  posts: RedditPost[]
): Record<string, number> {
  const sentimentDistribution: Record<string, number> = {
    Positive: 0,
    Neutral: 0,
    Negative: 0,
  }

  posts.forEach((post) => {
    const sentiment = post.sentimentCategory
    if (sentiment === null) return
    sentimentDistribution[sentiment]++
  })

  return sentimentDistribution
}
