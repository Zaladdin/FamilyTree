-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female');

-- CreateEnum
CREATE TYPE "PersonStatus" AS ENUM ('living', 'deceased');

-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('parent', 'spouse');

-- CreateEnum
CREATE TYPE "FamilyRole" AS ENUM ('owner', 'admin', 'editor', 'member', 'guest');

-- CreateEnum
CREATE TYPE "DigitizationTaskStatus" AS ENUM ('planned', 'in_progress', 'ready');

-- CreateEnum
CREATE TYPE "MediaAssetType" AS ENUM ('photo', 'audio');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('person_created', 'person_updated', 'media_added', 'media_deleted', 'person_archived', 'person_restored', 'story_added');

-- CreateTable
CREATE TABLE "Family" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "surname" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "coverQuote" TEXT NOT NULL,
    "peopleCount" INTEGER NOT NULL DEFAULT 0,
    "photosCount" INTEGER NOT NULL DEFAULT 0,
    "audioCount" INTEGER NOT NULL DEFAULT 0,
    "storiesCount" INTEGER NOT NULL DEFAULT 0,
    "contributorsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Family_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyMembership" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "role" "FamilyRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamilyMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigitizationTask" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "status" "DigitizationTaskStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigitizationTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "middleName" TEXT NOT NULL DEFAULT '',
    "gender" "Gender" NOT NULL,
    "birthDate" TEXT NOT NULL,
    "deathDate" TEXT,
    "birthPlace" TEXT NOT NULL,
    "status" "PersonStatus" NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "biography" TEXT NOT NULL,
    "note" TEXT,
    "photosCount" INTEGER NOT NULL DEFAULT 0,
    "audioCount" INTEGER NOT NULL DEFAULT 0,
    "documentsCount" INTEGER NOT NULL DEFAULT 0,
    "memoryTitle" TEXT,
    "memoryNarrator" TEXT,
    "memoryDuration" TEXT,
    "memorySummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "type" "MediaAssetType" NOT NULL,
    "title" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineEvent" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Story" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "narrator" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relationship" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "fromPersonId" TEXT NOT NULL,
    "toPersonId" TEXT NOT NULL,
    "type" "RelationshipType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Relationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "actorName" TEXT NOT NULL,
    "personId" TEXT,
    "personName" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Family_slug_key" ON "Family"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "FamilyMembership_familyId_idx" ON "FamilyMembership"("familyId");

-- CreateIndex
CREATE INDEX "FamilyMembership_userId_idx" ON "FamilyMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyMembership_familyId_userId_key" ON "FamilyMembership"("familyId", "userId");

-- CreateIndex
CREATE INDEX "DigitizationTask_familyId_idx" ON "DigitizationTask"("familyId");

-- CreateIndex
CREATE INDEX "Person_familyId_idx" ON "Person"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_familyId_firstName_lastName_middleName_birthDate_key" ON "Person"("familyId", "firstName", "lastName", "middleName", "birthDate");

-- CreateIndex
CREATE INDEX "MediaAsset_personId_type_idx" ON "MediaAsset"("personId", "type");

-- CreateIndex
CREATE INDEX "TimelineEvent_personId_order_idx" ON "TimelineEvent"("personId", "order");

-- CreateIndex
CREATE INDEX "Story_personId_createdAt_idx" ON "Story"("personId", "createdAt");

-- CreateIndex
CREATE INDEX "Relationship_familyId_idx" ON "Relationship"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "Relationship_familyId_fromPersonId_toPersonId_type_key" ON "Relationship"("familyId", "fromPersonId", "toPersonId", "type");

-- CreateIndex
CREATE INDEX "AuditLog_familyId_createdAt_idx" ON "AuditLog"("familyId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyMembership" ADD CONSTRAINT "FamilyMembership_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyMembership" ADD CONSTRAINT "FamilyMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitizationTask" ADD CONSTRAINT "DigitizationTask_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_fromPersonId_fkey" FOREIGN KEY ("fromPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_toPersonId_fkey" FOREIGN KEY ("toPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
