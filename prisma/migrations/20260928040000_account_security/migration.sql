ALTER TYPE "AuditAction" ADD VALUE 'invitation_created';
ALTER TYPE "AuditAction" ADD VALUE 'invitation_updated';
ALTER TYPE "AuditAction" ADD VALUE 'invitation_revoked';

-- Existing addresses were never verified. Keep their established memberships
-- and require password + mailbox proof before enabling email-only recovery.
ALTER TABLE "User"
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "legacyAccount" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ALTER COLUMN "legacyAccount" SET DEFAULT false;
ALTER TABLE "Session" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TYPE "AuthTokenPurpose" AS ENUM ('verify_email', 'password_reset');
CREATE TABLE "AuthToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "purpose" "AuthTokenPurpose" NOT NULL,
  "userId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "sessionVersion" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");
CREATE INDEX "AuthToken_userId_purpose_expiresAt_idx" ON "AuthToken"("userId", "purpose", "expiresAt");
CREATE INDEX "AuthToken_expiresAt_idx" ON "AuthToken"("expiresAt");
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');
CREATE TABLE "FamilyInvitation" (
  "id" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" "FamilyRole" NOT NULL,
  "invitedById" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
  "acceptedById" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FamilyInvitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FamilyInvitation_tokenHash_key" ON "FamilyInvitation"("tokenHash");
CREATE UNIQUE INDEX "FamilyInvitation_familyId_email_key" ON "FamilyInvitation"("familyId", "email");
CREATE INDEX "FamilyInvitation_invitedById_idx" ON "FamilyInvitation"("invitedById");
CREATE INDEX "FamilyInvitation_acceptedById_idx" ON "FamilyInvitation"("acceptedById");
CREATE INDEX "FamilyInvitation_familyId_status_expiresAt_idx" ON "FamilyInvitation"("familyId", "status", "expiresAt");
ALTER TABLE "FamilyInvitation" ADD CONSTRAINT "FamilyInvitation_familyId_fkey"
  FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FamilyInvitation" ADD CONSTRAINT "FamilyInvitation_invitedById_fkey"
  FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FamilyInvitation" ADD CONSTRAINT "FamilyInvitation_acceptedById_fkey"
  FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
