ALTER TYPE "AuditAction" ADD VALUE 'story_updated';
ALTER TYPE "AuditAction" ADD VALUE 'story_deleted';
ALTER TYPE "AuditAction" ADD VALUE 'story_restored';

ALTER TABLE "Story"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "Story_personId_deletedAt_idx" ON "Story"("personId", "deletedAt");

CREATE TYPE "TimelineEventKind" AS ENUM ('custom', 'birth', 'death');
ALTER TABLE "TimelineEvent" ADD COLUMN "kind" "TimelineEventKind" NOT NULL DEFAULT 'custom';

-- Recognize only the exact two-row template emitted by the old person form.
-- Keep every label intact; unmatched historical/custom text stays custom.
UPDATE "TimelineEvent" AS birth
SET "kind" = 'birth'
FROM "Person" AS person
WHERE birth."personId" = person."id"
  AND birth."order" = 0
  AND birth."createdAt" = person."createdAt"
  -- The old card editor could change birthDate without updating this label.
  AND birth."label" ~ '^([0-9]{4}(-[0-9]{2}){0,2}|([0-9]{2}[.]){1,2}[0-9]{4}) - рождение$'
  AND EXISTS (
    SELECT 1 FROM "TimelineEvent" AS added
    WHERE added."personId" = person."id" AND added."order" = 1
      AND added."createdAt" = person."createdAt"
      AND added."label" = EXTRACT(YEAR FROM person."createdAt")::INTEGER::TEXT
        || ' - добавлен(а) в цифровое дерево семьи'
  );
