-- CreateTable
CREATE TABLE "SubReddit" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,

    CONSTRAINT "SubReddit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Preferences" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT,
    "ingestionSchedule" TEXT,
    "ingestionActive" BOOLEAN NOT NULL DEFAULT false,

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
    "sentiment" DOUBLE PRECISION,
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
    "userId" TEXT NOT NULL,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],

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
    "userId" TEXT NOT NULL,
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
    "userId" TEXT NOT NULL,
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
CREATE TABLE "CategorizationSettings" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT,
    "triggerCategorization" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategorizationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSettings" (
    "id" SERIAL NOT NULL,
    "userId" TEXT,
    "orgId" TEXT,
    "emails" TEXT[],
    "issueThreshold" INTEGER NOT NULL,
    "timeWindow" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastNotified" TIMESTAMP(3),
    "volumeThresholdMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentimentThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commentGrowthThreshold" DOUBLE PRECISION NOT NULL DEFAULT 2.0,

    CONSTRAINT "NotificationSettings_pkey" PRIMARY KEY ("id")
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

    CONSTRAINT "NotificationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostMetrics" (
    "id" SERIAL NOT NULL,
    "postId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "numComments" INTEGER NOT NULL,
    "sameIssuesCount" INTEGER NOT NULL,
    "sentiment" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommentMetrics" (
    "id" SERIAL NOT NULL,
    "commentId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "sentiment" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubReddit_userId_name_key" ON "SubReddit"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SubReddit_orgId_name_key" ON "SubReddit"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Preferences_userId_key" ON "Preferences"("userId");

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
CREATE UNIQUE INDEX "CategorizationSettings_userId_key" ON "CategorizationSettings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CategorizationSettings_orgId_key" ON "CategorizationSettings"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSettings_userId_key" ON "NotificationSettings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSettings_orgId_key" ON "NotificationSettings"("orgId");

-- CreateIndex
CREATE INDEX "NotificationHistory_userId_idx" ON "NotificationHistory"("userId");

-- CreateIndex
CREATE INDEX "NotificationHistory_orgId_idx" ON "NotificationHistory"("orgId");

-- CreateIndex
CREATE INDEX "NotificationHistory_sentAt_idx" ON "NotificationHistory"("sentAt");

-- CreateIndex
CREATE INDEX "PostMetrics_postId_timestamp_idx" ON "PostMetrics"("postId", "timestamp");

-- CreateIndex
CREATE INDEX "CommentMetrics_commentId_timestamp_idx" ON "CommentMetrics"("commentId", "timestamp");

-- AddForeignKey
ALTER TABLE "RedditComment" ADD CONSTRAINT "RedditComment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "RedditComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedditComment" ADD CONSTRAINT "RedditComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "RedditPost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMetrics" ADD CONSTRAINT "PostMetrics_postId_fkey" FOREIGN KEY ("postId") REFERENCES "RedditPost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentMetrics" ADD CONSTRAINT "CommentMetrics_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "RedditComment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
