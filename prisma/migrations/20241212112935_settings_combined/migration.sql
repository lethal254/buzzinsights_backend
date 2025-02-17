/*
  Warnings:

  - You are about to drop the `CategorizationSettings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `NotificationSettings` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[orgId]` on the table `Preferences` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Preferences" ADD COLUMN     "commentGrowthThreshold" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "emails" TEXT[],
ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "issueThreshold" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastNotified" TIMESTAMP(3),
ADD COLUMN     "sentimentThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "timeWindow" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "triggerCategorization" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "volumeThresholdMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5;

-- DropTable
DROP TABLE "CategorizationSettings";

-- DropTable
DROP TABLE "NotificationSettings";

-- CreateIndex
CREATE UNIQUE INDEX "Preferences_orgId_key" ON "Preferences"("orgId");

-- RenameIndex
ALTER INDEX "Preferences_userId_key" RENAME TO "Preferences_userId_unique";
