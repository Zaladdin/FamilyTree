import test, { after } from "node:test";
import assert from "node:assert/strict";
import { HttpError } from "@/lib/http-error";
import { disconnectTestPrisma, withTestUser } from "./helpers";

after(disconnectTestPrisma);

test("concurrent reset consumes once, verifies a new account, and rejects a login issued with the old credential generation", async () => {
  await withTestUser(async ({ prisma, user, password }) => {
    const { createSession, authenticateUser } = await import("@/lib/auth");
    const { generateAuthToken, authTokenExpiry } = await import("@/lib/auth-token");
    const { resetAccountPassword } = await import("@/lib/auth-account");
    const { readValidSession } = await import("@/lib/session-reader");
    const authenticatedBeforeReset = await authenticateUser(user.email, password);
    await createSession(user.id, user.sessionVersion);
    await createSession(user.id, user.sessionVersion);
    const reset = generateAuthToken(); const verify = generateAuthToken();
    await prisma.authToken.createMany({ data: [
      { tokenHash: reset.tokenHash, purpose: "password_reset", userId: user.id, email: user.email, sessionVersion: user.sessionVersion, expiresAt: authTokenExpiry("password_reset") },
      { tokenHash: verify.tokenHash, purpose: "verify_email", userId: user.id, email: user.email, sessionVersion: user.sessionVersion, expiresAt: authTokenExpiry("verify_email") },
    ] });
    const newPassword = "new-integration-only-password";
    const input = { token: reset.token, password: newPassword, passwordConfirmation: newPassword };
    const outcomes = await Promise.allSettled([resetAccountPassword(input), resetAccountPassword(input)]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    assert.ok(rejected?.status === "rejected" && rejected.reason instanceof HttpError && [400, 409].includes(rejected.reason.status));
    const changed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(changed.sessionVersion, user.sessionVersion + 1); assert.ok(changed.emailVerifiedAt);
    assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.authToken.count({ where: { userId: user.id, consumedAt: null } }), 0);
    const stale = await createSession(user.id, authenticatedBeforeReset.sessionVersion);
    const lookup = (tokenHash: string) => prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
    assert.equal(await readValidSession(stale.token, lookup), null);
    const freshUser = await authenticateUser(user.email, newPassword);
    const fresh = await createSession(user.id, freshUser.sessionVersion);
    assert.equal((await readValidSession(fresh.token, lookup))?.userId, user.id);
  });
});

test("revoke other sessions keeps only the authenticated session at the new generation", async () => {
  await withTestUser(async ({ prisma, user, password }) => {
    const { createSession, hashSessionToken } = await import("@/lib/auth");
    const { revokeOtherAccountSessions } = await import("@/lib/auth-account");
    const current = await createSession(user.id, user.sessionVersion);
    const other = await createSession(user.id, user.sessionVersion);
    const row = await prisma.session.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(current.token) } });
    await revokeOtherAccountSessions({ userId: user.id, sessionId: row.id, currentPassword: password });
    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    assert.equal(sessions.length, 1); assert.equal(sessions[0].id, row.id);
    assert.equal(sessions[0].sessionVersion, user.sessionVersion + 1);
    assert.equal(await prisma.session.findUnique({ where: { tokenHash: hashSessionToken(other.token) } }), null);
  });
});

test("legacy unverified accounts keep existing sessions and cannot request mailbox-only recovery", async () => {
  await withTestUser(async ({ prisma, user }) => {
    const { createSession, hashSessionToken } = await import("@/lib/auth");
    const { requestPasswordReset } = await import("@/lib/auth-account");
    const { readValidSession } = await import("@/lib/session-reader");
    await prisma.user.update({ where: { id: user.id }, data: { legacyAccount: true } });
    const current = await createSession(user.id, user.sessionVersion);
    let deliveries = 0;
    await requestPasswordReset(user.email, async () => { deliveries += 1; return true; });
    assert.equal(deliveries, 0);
    assert.equal(await prisma.authToken.count({ where: { userId: user.id } }), 0);
    assert.ok(await readValidSession(current.token, (tokenHash) => prisma.session.findUnique({ where: { tokenHash }, include: { user: true } })));
    assert.ok(await prisma.session.findUnique({ where: { tokenHash: hashSessionToken(current.token) } }));
  });
});
