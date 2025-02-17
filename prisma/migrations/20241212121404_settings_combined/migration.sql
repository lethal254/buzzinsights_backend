/*
  Warnings:

  - You are about to drop the `CommentMetrics` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PostMetrics` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "CommentMetrics" DROP CONSTRAINT "CommentMetrics_commentId_fkey";

-- DropForeignKey
ALTER TABLE "PostMetrics" DROP CONSTRAINT "PostMetrics_postId_fkey";

-- DropTable
DROP TABLE "CommentMetrics";

-- DropTable
DROP TABLE "PostMetrics";

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

-- CreateIndex
CREATE INDEX "WindowMetrics_userId_idx" ON "WindowMetrics"("userId");

-- CreateIndex
CREATE INDEX "WindowMetrics_orgId_idx" ON "WindowMetrics"("orgId");

-- CreateIndex
CREATE INDEX "WindowMetrics_timestamp_idx" ON "WindowMetrics"("timestamp");
