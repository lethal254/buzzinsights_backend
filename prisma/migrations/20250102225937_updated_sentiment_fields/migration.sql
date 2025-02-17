/*
  Warnings:

  - You are about to drop the column `sentiment` on the `RedditPost` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "RedditPost" DROP COLUMN "sentiment",
ADD COLUMN     "sentimentCategory" TEXT,
ADD COLUMN     "sentimentScore" DOUBLE PRECISION;
