import test, { after } from "node:test";
import assert from "node:assert/strict";
import { HttpError } from "@/lib/http-error";
import { disconnectTestPrisma, withTestUser } from "./helpers";

after(disconnectTestPrisma);

test("authenticateUser allows its fixture user and rejects bad or unknown credentials", async () => {
  await withTestUser(async ({ user, password }) => {
    const { authenticateUser } = await import("@/lib/auth");
    assert.equal((await authenticateUser(user.email, password)).id, user.id);
    for (const [email, candidate] of [[user.email, "bad-password"], [`missing-${user.email}`, password]]) {
      await assert.rejects(
        () => authenticateUser(email, candidate),
        (error) => error instanceof HttpError && error.status === 401,
      );
    }
  });
});

test("getFamilyRoleForUserId returns its fixture membership and no unrelated access", async () => {
  await withTestUser(async ({ user }) => {
    const { createFamilySpace } = await import("@/lib/family-admin-repository");
    const { getFamilyRoleForUserId } = await import("@/lib/auth");
    const family = await createFamilySpace({
      user,
      input: { title: "Тестовая семья", surname: user.id, region: "Баку", description: "Integration fixture" },
    });
    assert.equal(await getFamilyRoleForUserId(user.id, family.slug), "owner");
    assert.equal(await getFamilyRoleForUserId(`missing-${user.id}`, family.slug), null);
  });
});

test("createSession stores only a token hash and destroySession revokes it", async () => {
  await withTestUser(async ({ prisma, user }) => {
    const { createSession, hashSessionToken, destroySession } = await import("@/lib/auth");
    const session = await createSession(user.id, user.sessionVersion);
    const tokenHash = hashSessionToken(session.token);
    const stored = await prisma.session.findUnique({ where: { tokenHash } });
    assert.ok(stored);
    assert.equal(stored.userId, user.id);
    assert.notEqual(stored.tokenHash, session.token);
    await destroySession(session.token);
    assert.equal(await prisma.session.findUnique({ where: { tokenHash } }), null);
  });
});
