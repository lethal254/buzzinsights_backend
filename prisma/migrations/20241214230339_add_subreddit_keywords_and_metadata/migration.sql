/*
  Warnings:

  - Added the required column `updatedAt` to the `SubReddit` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SubReddit" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "lastIngested" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
