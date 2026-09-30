import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { HttpError } from "@/lib/http-error";
import { disconnectTestPrisma, withTestUser } from "./helpers";

after(disconnectTestPrisma);

test("legacy owner keeps access while unverified recipient receives no new membership", async () => {
  await withTestUser(async ({ prisma, user }) => {
    const { createFamilySpace } = await import("@/lib/family-admin-repository");
    const { getFamilyRoleForUserId } = await import("@/lib/auth");
    const { createFamilyInvitation, acceptFamilyInvitation } = await import("@/lib/family-invitations");
    const { generateAuthToken } = await import("@/lib/auth-token");
    await prisma.user.update({ where: { id: user.id }, data: { legacyAccount: true } });
    const { slug } = await createFamilySpace({ user, input: { title: "Приглашения", surname: user.id, region: "Тест", description: "Synthetic test fixture" } });
    const family = await prisma.family.findUniqueOrThrow({ where: { slug } });
    const recipient = await prisma.user.create({ data: { email: `invite-${randomUUID()}@example.invalid`, firstName: "Тест", lastName: "Получатель", passwordHash: "unused-fixture-password-hash" } });
    try {
      const created = await createFamilyInvitation({ slug, email: recipient.email, role: "editor", actor: { userId: user.id, name: "Владелец" } });
      assert.equal(created.delivery, "unavailable");
      assert.equal(await getFamilyRoleForUserId(user.id, slug), "owner");
      const legacyOwner = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(legacyOwner.emailVerifiedAt, null);
      assert.equal(legacyOwner.legacyAccount, true);
      assert.equal(await getFamilyRoleForUserId(recipient.id, slug), null);
      // A known token belongs only to this disposable fixture; no application token is returned.
      const { token, tokenHash } = generateAuthToken();
      await prisma.familyInvitation.update({ where: { id: created.invitation.id }, data: { tokenHash } });
      await assert.rejects(acceptFamilyInvitation({ token, userId: recipient.id }), (error: unknown) => error instanceof HttpError && error.status === 403);
      assert.equal(await prisma.familyMembership.count({ where: { familyId: family.id } }), 1);
      await prisma.user.update({ where: { id: recipient.id }, data: { emailVerifiedAt: new Date() } });
      await acceptFamilyInvitation({ token, userId: recipient.id });
      assert.equal(await getFamilyRoleForUserId(recipient.id, slug), "editor");
      assert.equal((await prisma.family.findUniqueOrThrow({ where: { id: family.id } })).contributorsCount, 2);
    } finally {
      await prisma.user.delete({ where: { id: recipient.id } });
    }
  });
});

test("revocation and resend invalidate earlier invitation links in PostgreSQL", async () => {
  await withTestUser(async ({ prisma, user }) => {
    const { createFamilySpace } = await import("@/lib/family-admin-repository");
    const { acceptFamilyInvitation, revokeFamilyInvitation, resendFamilyInvitation } = await import("@/lib/family-invitations");
    const { generateAuthToken } = await import("@/lib/auth-token");
    const { slug } = await createFamilySpace({ user, input: { title: "Отзыв приглашения", surname: user.id, region: "Тест", description: "Synthetic test fixture" } });
    const family = await prisma.family.findUniqueOrThrow({ where: { slug } });
    const recipient = await prisma.user.create({ data: { email: `invite-${randomUUID()}@example.invalid`, firstName: "Тест", lastName: "Получатель", passwordHash: "unused-fixture-password-hash", emailVerifiedAt: new Date() } });
    try {
      const { token, tokenHash } = generateAuthToken();
      const invitation = await prisma.familyInvitation.create({ data: { familyId: family.id, email: recipient.email, role: "member", invitedById: user.id, tokenHash, expiresAt: new Date(Date.now() + 60_000) } });
      const params = { slug, invitationId: invitation.id, expectedVersion: 0, actor: { userId: user.id, name: "Владелец" } };
      await revokeFamilyInvitation(params);
      await assert.rejects(acceptFamilyInvitation({ token, userId: recipient.id }), (error: unknown) => error instanceof HttpError && error.status === 410);
      await resendFamilyInvitation({ ...params, expectedVersion: 1 });
      await assert.rejects(acceptFamilyInvitation({ token, userId: recipient.id }), (error: unknown) => error instanceof HttpError && error.status === 400);
      assert.equal(await prisma.familyMembership.count({ where: { familyId: family.id, userId: recipient.id } }), 0);
    } finally {
      await prisma.user.delete({ where: { id: recipient.id } });
    }
  });
});
