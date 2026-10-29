-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "completedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Refund_businessId_status_completedAt_idx" ON "Refund"("businessId", "status", "completedAt");
