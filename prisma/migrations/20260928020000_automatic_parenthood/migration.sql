-- Legacy edges remain recorded facts; no automatic backfill of parent links.
CREATE TYPE "RelationshipOrigin" AS ENUM ('manual', 'spouse', 'sibling');

ALTER TABLE "Relationship"
  ADD COLUMN "origin" "RelationshipOrigin" NOT NULL DEFAULT 'manual',
  ADD COLUMN "sourcePersonId" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ParentSuppression" (
  "id" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "fromPersonId" TEXT NOT NULL,
  "toPersonId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParentSuppression_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ParentSuppression_familyId_fromPersonId_toPersonId_key"
  ON "ParentSuppression"("familyId", "fromPersonId", "toPersonId");
CREATE INDEX "ParentSuppression_fromPersonId_idx" ON "ParentSuppression"("fromPersonId");
CREATE INDEX "ParentSuppression_toPersonId_idx" ON "ParentSuppression"("toPersonId");
ALTER TABLE "ParentSuppression" ADD CONSTRAINT "ParentSuppression_familyId_fkey"
  FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParentSuppression" ADD CONSTRAINT "ParentSuppression_fromPersonId_fkey"
  FOREIGN KEY ("fromPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParentSuppression" ADD CONSTRAINT "ParentSuppression_toPersonId_fkey"
  FOREIGN KEY ("toPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
