/*
  Warnings:

  - You are about to drop the `BucketSuggestion` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "BucketSuggestion" DROP CONSTRAINT "BucketSuggestion_bucketId_fkey";

-- DropForeignKey
ALTER TABLE "BucketSuggestion" DROP CONSTRAINT "BucketSuggestion_postId_fkey";

-- DropTable
DROP TABLE "BucketSuggestion";
