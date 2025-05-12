-- CreateTable
CREATE TABLE "FeedbackBucket" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "userId" TEXT,
    "orgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FeedbackBucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_FeedbackBucketToRedditPost" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_FeedbackBucketToRedditPost_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "FeedbackBucket_userId_idx" ON "FeedbackBucket"("userId");

-- CreateIndex
CREATE INDEX "FeedbackBucket_orgId_idx" ON "FeedbackBucket"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackBucket_userId_name_key" ON "FeedbackBucket"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackBucket_orgId_name_key" ON "FeedbackBucket"("orgId", "name");

-- CreateIndex
CREATE INDEX "_FeedbackBucketToRedditPost_B_index" ON "_FeedbackBucketToRedditPost"("B");

-- AddForeignKey
ALTER TABLE "_FeedbackBucketToRedditPost" ADD CONSTRAINT "_FeedbackBucketToRedditPost_A_fkey" FOREIGN KEY ("A") REFERENCES "FeedbackBucket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FeedbackBucketToRedditPost" ADD CONSTRAINT "_FeedbackBucketToRedditPost_B_fkey" FOREIGN KEY ("B") REFERENCES "RedditPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
