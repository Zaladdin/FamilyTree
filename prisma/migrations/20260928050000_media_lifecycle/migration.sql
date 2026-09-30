-- Existing assets stay visible and charged; hashes are filled only by new uploads.
-- Deploy with all writers stopped: old servers do not understand pending/deleting.
CREATE TYPE "MediaAssetState" AS ENUM ('pending', 'ready', 'deleting', 'failed');
ALTER TYPE "AuditAction" ADD VALUE 'media_cleanup_failed';

ALTER TABLE "MediaAsset"
  ADD COLUMN "state" "MediaAssetState" NOT NULL DEFAULT 'ready',
  ADD COLUMN "checksum" TEXT,
  ADD COLUMN "cleanupAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastErrorCode" TEXT,
  ADD COLUMN "cleanupAfter" TIMESTAMP(3),
  ADD COLUMN "cleanupLeaseUntil" TIMESTAMP(3),
  ADD COLUMN "cleanupLeaseToken" TEXT;

CREATE INDEX "MediaAsset_state_cleanupAfter_idx" ON "MediaAsset"("state", "cleanupAfter");
