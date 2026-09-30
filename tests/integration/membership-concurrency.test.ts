import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { HttpError } from "@/lib/http-error";
import { disconnectTestPrisma, withTestUser } from "./helpers";
import { overrideTransaction } from "./transaction-override";

// helpers validates TEST_DATABASE_URL before any runtime Prisma/repository import.
after(disconnectTestPrisma);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

type Fixture = {
  prisma: PrismaClient;
  familyId: string;
  slug: string;
  targetId: string;
  owner: { userId: string; name: string };
  admin: { userId: string; name: string };
};

async function withMembershipFixture(run: (fixture: Fixture) => Promise<void>) {
  await withTestUser(async ({ prisma, user }) => {
    const { createFamilySpace } = await import("@/lib/family-admin-repository");
    const family = await createFamilySpace({
      user,
      input: { title: "Тест конкуренции", surname: user.id, region: "Баку", description: "Integration fixture" },
    });
    const familyId = (await prisma.family.findUniqueOrThrow({ where: { slug: family.slug } })).id;
    const users = await Promise.all(["admin", "target"].map((label) => prisma.user.create({ data: {
      email: `${label}-${randomUUID()}@example.invalid`, firstName: "Тест", lastName: label, passwordHash: user.passwordHash,
    } })));
    try {
      const admin = await prisma.familyMembership.create({ data: { familyId, userId: users[0].id, name: "Тест admin", role: "admin" } });
      const target = await prisma.familyMembership.create({ data: { familyId, userId: users[1].id, name: "Тест target", role: "member" } });
      await prisma.family.update({ where: { id: familyId }, data: { contributorsCount: 3 } });
      await run({ prisma, familyId, slug: family.slug, targetId: target.id, owner: { userId: user.id, name: "Тест Владелец" }, admin: { userId: admin.userId!, name: admin.name } });
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
    }
  });
}

/** Pause at an actual repository write, after its reads, without mocking PostgreSQL. */
function interceptWrites(
  t: TestContext,
  prisma: PrismaClient,
  method: "update" | "delete" | "create" | "updateMany",
  beforeWrite: () => Promise<void>,
  model: "familyMembership" | "familyInvitation" = "familyMembership",
) {
  const original = prisma.$transaction.bind(prisma) as <T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ) => Promise<T>;
  let attempts = 0;
  const replacement = async <T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ) => {
    attempts += 1;
    return original(async (transaction) => {
      const memberships = new Proxy(transaction[model], {
        get(target, property) {
          if (property !== method) return Reflect.get(target, property);
          return async (args: unknown) => {
            await beforeWrite();
            const write = Reflect.get(target, property) as (args: unknown) => Promise<unknown>;
            return write.call(target, args);
          };
        },
      });
      return operation(new Proxy(transaction, {
        get(target, property) { return property === model ? memberships : Reflect.get(target, property); },
      }));
    }, options);
  };
  const restore = overrideTransaction(t, prisma, replacement as typeof prisma.$transaction);
  return { attempts: () => attempts, restore };
}

const isForbidden = (error: unknown) => error instanceof HttpError && error.status === 403;

for (const method of ["update", "delete"] as const) {
  test(`concurrent admin promotion prevents a stale ${method} after serialization retry`, { timeout: 30_000 }, async (t) => {
    await withMembershipFixture(async ({ prisma, familyId, slug, targetId, owner, admin }) => {
      const { updateFamilyMemberRole, removeFamilyMember } = await import("@/lib/family-members");
      const reachedWrite = deferred();
      const releaseWrite = deferred();
      let paused = false;
      const interception = interceptWrites(t, prisma, method, async () => {
        if (paused) return;
        paused = true;
        reachedWrite.resolve();
        await releaseWrite.promise;
      });
      const pending = method === "update"
        ? updateFamilyMemberRole({ slug, membershipId: targetId, role: "editor", actor: admin })
        : removeFamilyMember({ slug, membershipId: targetId, actor: admin });
      try {
        await Promise.race([reachedWrite.promise, pending.then(() => { throw new Error("Expected paused membership write"); })]);
        await updateFamilyMemberRole({ slug, membershipId: targetId, role: "admin", actor: owner });
        releaseWrite.resolve();
        await assert.rejects(pending, isForbidden);
        assert.ok(interception.attempts() >= 3, "owner transaction plus the rejected request and its retry");
        assert.equal((await prisma.familyMembership.findUniqueOrThrow({ where: { id: targetId } })).role, "admin");
        assert.equal((await prisma.family.findUniqueOrThrow({ where: { id: familyId } })).contributorsCount, 3);
        assert.equal(await prisma.auditLog.count({ where: { familyId, action: "member_role_changed" } }), 1);
        assert.equal(await prisma.auditLog.count({ where: { familyId, action: "member_removed" } }), 0);
      } finally {
        releaseWrite.resolve();
        await Promise.allSettled([pending]);
        interception.restore();
      }
    });
  });
}

test("concurrent duplicate removals commit exactly one counter decrement and audit", { timeout: 30_000 }, async (t) => {
  await withMembershipFixture(async ({ prisma, familyId, slug, targetId, owner }) => {
    const { removeFamilyMember } = await import("@/lib/family-members");
    const release = deferred();
    let writes = 0;
    const interception = interceptWrites(t, prisma, "delete", async () => {
      writes += 1;
      if (writes === 2) release.resolve();
      await release.promise;
    });
    try {
      const results = await Promise.allSettled([
        removeFamilyMember({ slug, membershipId: targetId, actor: owner }),
        removeFamilyMember({ slug, membershipId: targetId, actor: owner }),
      ]);
      assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
      const failed = results.find((result) => result.status === "rejected");
      assert.ok(failed?.status === "rejected" && failed.reason instanceof HttpError && failed.reason.status === 404);
      assert.equal(await prisma.familyMembership.count({ where: { familyId } }), 2);
      assert.equal((await prisma.family.findUniqueOrThrow({ where: { id: familyId } })).contributorsCount, 2);
      assert.equal(await prisma.auditLog.count({ where: { familyId, action: "member_removed" } }), 1);
    } finally {
      release.resolve();
      interception.restore();
    }
  });
});

test("concurrent verified invitation acceptance creates one membership, counter and audit", { timeout: 30_000 }, async (t) => {
  await withMembershipFixture(async ({ prisma, familyId, slug, owner }) => {
    const { acceptFamilyInvitation } = await import("@/lib/family-invitations");
    const { generateAuthToken } = await import("@/lib/auth-token");
    const user = await prisma.user.create({ data: {
      email: `candidate-${randomUUID()}@example.invalid`, firstName: "Новый", lastName: "Участник", passwordHash: "unused-fixture-password-hash", emailVerifiedAt: new Date(),
    } });
    const { token, tokenHash } = generateAuthToken();
    await prisma.familyInvitation.create({ data: { familyId, email: user.email, role: "member", invitedById: owner.userId, tokenHash, expiresAt: new Date(Date.now() + 60_000) } });
    const release = deferred();
    let writes = 0;
    const interception = interceptWrites(t, prisma, "updateMany", async () => {
      writes += 1;
      if (writes === 2) release.resolve();
      await release.promise;
    }, "familyInvitation");
    try {
      const results = await Promise.all([
        acceptFamilyInvitation({ token, userId: user.id }),
        acceptFamilyInvitation({ token, userId: user.id }),
      ]);
      assert.equal(results[0].membershipId, results[1].membershipId);
      assert.deepEqual(results.map((result) => result.alreadyAccepted).sort(), [false, true]);
      assert.equal(results[0].slug, slug);
      assert.equal(await prisma.familyMembership.count({ where: { familyId, userId: user.id } }), 1);
      assert.equal((await prisma.family.findUniqueOrThrow({ where: { id: familyId } })).contributorsCount, 4);
      assert.equal(await prisma.auditLog.count({ where: { familyId, action: "member_added" } }), 1);
    } finally {
      release.resolve();
      interception.restore();
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
