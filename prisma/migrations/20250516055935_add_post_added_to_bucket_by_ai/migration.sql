-- AlterTable
ALTER TABLE "RedditPost" ADD COLUMN     "addedToBucketByAI" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BucketSuggestion" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "bucketId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BucketSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BucketSuggestion_postId_idx" ON "BucketSuggestion"("postId");

-- CreateIndex
CREATE INDEX "BucketSuggestion_bucketId_idx" ON "BucketSuggestion"("bucketId");

-- CreateIndex
CREATE UNIQUE INDEX "BucketSuggestion_postId_bucketId_key" ON "BucketSuggestion"("postId", "bucketId");

-- AddForeignKey
ALTER TABLE "BucketSuggestion" ADD CONSTRAINT "BucketSuggestion_postId_fkey" FOREIGN KEY ("postId") REFERENCES "RedditPost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BucketSuggestion" ADD CONSTRAINT "BucketSuggestion_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "FeedbackBucket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
