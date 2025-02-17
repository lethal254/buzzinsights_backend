export interface NotificationJobData {
  targetId: string
  isOrg: boolean
}

export interface CategoryTrend {
  category: string
  currentCount: number
  previousCount: number
  posts: Array<{
    id: string
    title: string
    numComments: number
    sentimentScore: number | null
    sentimentCategory: string | null
    category: string | null
    createdUtc: bigint
    lastUpdated: bigint
  }>
}

export interface NotificationMetrics {
  currentCount: number
  previousCount: number
  currentCommentCount: number
  previousCommentCount: number
  averageSentiment: number
  commentGrowthRate: number
  categoryTrends: CategoryTrend[]
}
