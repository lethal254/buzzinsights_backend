-- CreateEnum
CREATE TYPE "Role" AS ENUM ('user', 'assistant');

-- CreateTable
CREATE TABLE "SubReddit" (
    "id" SERIAL NOT NULL,
    "userId" TEXT,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastIngested" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubReddit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Preferences" (
    "id" SERIAL NOT NULL,
    "userId" TEXT,
    "orgId" TEXT,
    "ingestionSchedule" TEXT,
    "ingestionActive" BOOLEAN NOT NULL DEFAULT false,
    "commentGrowthThreshold" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "issueThreshold" INTEGER NOT NULL DEFAULT 0,
    "lastNotified" TIMESTAMP(3),
    "sentimentThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "timeWindow" INTEGER NOT NULL DEFAULT 24,
    "triggerCategorization" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "volumeThresholdMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,

    CONSTRAINT "Preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedditPost" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "createdUtc" BIGINT NOT NULL,
    "score" INTEGER NOT NULL,
    "numComments" INTEGER NOT NULL,
    "lastUpdated" BIGINT NOT NULL,
    "needsProcessing" BOOLEAN NOT NULL DEFAULT true,
    "processingPriority" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT,
    "product" TEXT,
    "sameIssuesCount" INTEGER DEFAULT 0,
    "sameDeviceCount" INTEGER DEFAULT 0,
    "solutionsCount" INTEGER DEFAULT 0,
    "updateIssueMention" INTEGER DEFAULT 0,
    "updateResolvedMention" INTEGER DEFAULT 0,
    "authorProfilePhoto" TEXT,
    "imageUrl" TEXT,
    "orgId" TEXT,
    "thumbnail" TEXT,
    "userId" TEXT,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "permalink" TEXT,
    "sentimentCategory" TEXT,
    "sentimentScore" DOUBLE PRECISION,

    CONSTRAINT "RedditPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedditComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "parentCommentId" TEXT,
    "author" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdUtc" BIGINT NOT NULL,
    "score" INTEGER NOT NULL,
    "lastUpdated" BIGINT NOT NULL,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "RedditComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackCategory" (
    "id" SERIAL NOT NULL,
    "userId" TEXT,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "keywords" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" SERIAL NOT NULL,
    "userId" TEXT,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "keywords" TEXT[],
    "versions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationHistory" (
    "id" SERIAL NOT NULL,
    "userId" TEXT,
    "orgId" TEXT,
    "postIds" TEXT[],
    "category" TEXT NOT NULL,
    "product" TEXT,
    "issueCount" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailsSentTo" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WindowMetrics" (
    "id" SERIAL NOT NULL,
    "userId" TEXT,
    "orgId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalPosts" INTEGER NOT NULL,
    "totalComments" INTEGER NOT NULL,
    "totalUpvotes" INTEGER NOT NULL,
    "topTrendingPosts" JSONB NOT NULL,
    "categoryTrends" JSONB NOT NULL,
    "sentimentAnalysis" JSONB NOT NULL,
    "sameIssuesCount" INTEGER NOT NULL,
    "sameDeviceCount" INTEGER NOT NULL,
    "solutionsCount" INTEGER NOT NULL,
    "updateIssueMention" INTEGER NOT NULL,
    "updateResolvedMention" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WindowMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "userId" TEXT,
    "orgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubReddit_userId_name_key" ON "SubReddit"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SubReddit_orgId_name_key" ON "SubReddit"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Preferences_userId_unique" ON "Preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Preferences_orgId_key" ON "Preferences"("orgId");

-- CreateIndex
CREATE INDEX "RedditPost_userId_idx" ON "RedditPost"("userId");

-- CreateIndex
CREATE INDEX "RedditPost_orgId_idx" ON "RedditPost"("orgId");

-- CreateIndex
CREATE INDEX "RedditComment_postId_idx" ON "RedditComment"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackCategory_userId_name_key" ON "FeedbackCategory"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackCategory_orgId_name_key" ON "FeedbackCategory"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_userId_name_key" ON "ProductCategory"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_orgId_name_key" ON "ProductCategory"("orgId", "name");

-- CreateIndex
CREATE INDEX "NotificationHistory_userId_idx" ON "NotificationHistory"("userId");

-- CreateIndex
CREATE INDEX "NotificationHistory_orgId_idx" ON "NotificationHistory"("orgId");

-- CreateIndex
CREATE INDEX "NotificationHistory_sentAt_idx" ON "NotificationHistory"("sentAt");

-- CreateIndex
CREATE INDEX "WindowMetrics_userId_idx" ON "WindowMetrics"("userId");

-- CreateIndex
CREATE INDEX "WindowMetrics_orgId_idx" ON "WindowMetrics"("orgId");

-- CreateIndex
CREATE INDEX "WindowMetrics_timestamp_idx" ON "WindowMetrics"("timestamp");

-- CreateIndex
CREATE INDEX "Chat_orgId_idx" ON "Chat"("orgId");

-- CreateIndex
CREATE INDEX "Chat_userId_idx" ON "Chat"("userId");

-- CreateIndex
CREATE INDEX "Message_chatId_idx" ON "Message"("chatId");

-- AddForeignKey
ALTER TABLE "RedditComment" ADD CONSTRAINT "RedditComment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "RedditComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedditComment" ADD CONSTRAINT "RedditComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "RedditPost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
