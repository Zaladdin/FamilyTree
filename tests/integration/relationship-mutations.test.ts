import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, User } from "@prisma/client";
import { HttpError } from "@/lib/http-error";
import { disconnectTestPrisma, withTestUser } from "./helpers";
import { overrideTransaction } from "./transaction-override";

after(disconnectTestPrisma);

async function fixture(prisma: PrismaClient, user: User) {
  const { createFamilySpace } = await import("@/lib/family-admin-repository");
  const { slug } = await createFamilySpace({ user, input: {
    title: "Проверка связей", surname: user.id, region: "Баку", description: "Disposable relationship test",
  } });
  const family = await prisma.family.findUniqueOrThrow({ where: { slug } });
  const ids = { mom: randomUUID(), dad: randomUUID(), child: randomUUID(), other: randomUUID() };
  await prisma.person.createMany({ data: Object.entries(ids).map(([firstName, id]) => ({
    id, familyId: family.id, firstName, lastName: "Тест", gender: "male", birthDate: "1980",
    birthPlace: "Баку", status: "living", biography: "Disposable relationship fixture",
  })) });
  await prisma.relationship.create({ data: { familyId: family.id, fromPersonId: ids.mom, toPersonId: ids.child, type: "parent" } });
  return { slug, familyId: family.id, ids };
}

function synchronizedGraphReads(t: TestContext, prisma: PrismaClient) {
  let arrivals = 0;
  let release!: () => void;
  let reject!: (error: Error) => void;
  let timer: NodeJS.Timeout | undefined;
  const barrier = new Promise<void>((resolve, fail) => { release = resolve; reject = fail; });
  const original = prisma.$transaction.bind(prisma) as <T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ) => Promise<T>;
  const patched = async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }) =>
    original(async (tx) => {
      const family = new Proxy(tx.family, { get(target, property, receiver) {
        if (property !== "findUnique") return Reflect.get(target, property, receiver);
        return async (...args: Parameters<typeof tx.family.findUnique>) => {
          const result = await tx.family.findUnique(...args);
          arrivals += 1;
          if (arrivals === 1) timer = setTimeout(() => reject(new Error("Concurrent graph reads did not reach the barrier")), 3000);
          if (arrivals === 2) { clearTimeout(timer); release(); }
          if (arrivals <= 2) await barrier;
          return result;
        };
      } });
      return operation(new Proxy(tx, { get(target, property, receiver) {
        return property === "family" ? family : Reflect.get(target, property, receiver);
      } }));
    }, options);
  const restore = overrideTransaction(t, prisma, patched as typeof prisma.$transaction);
  return () => { clearTimeout(timer); restore(); };
}

test("concurrent inverse spouse requests persist one marriage and one inferred parent", { timeout: 30_000 }, async (t) => {
  await withTestUser(async ({ prisma, user }) => {
    const { createRelationshipInFamily } = await import("@/lib/family-relationship-repository");
    const { slug, familyId, ids } = await fixture(prisma, user);
    const restore = synchronizedGraphReads(t, prisma);
    try {
      const results = await Promise.allSettled([
        createRelationshipInFamily(slug, ids.mom, { relativePersonId: ids.dad, relationshipKind: "spouse" }, "Тест", user.id),
        createRelationshipInFamily(slug, ids.dad, { relativePersonId: ids.mom, relationshipKind: "spouse" }, "Тест", user.id),
      ]);
      assert.equal(results.every((result) => result.status === "fulfilled"), true);
    } finally { restore(); }
    const relationships = await prisma.relationship.findMany({ where: { familyId } });
    assert.equal(relationships.length, 3);
    assert.equal(relationships.filter((item) => item.type === "spouse").length, 1);
    const parent = relationships.find((item) => item.type === "parent" && item.fromPersonId === ids.dad);
    assert.equal(parent?.origin, "spouse");
    assert.equal(parent?.sourcePersonId, ids.mom);
    assert.equal(await prisma.auditLog.count({ where: { familyId, action: "person_updated" } }), 2);
  });
});

test("parent deletion survives repeated inference and explicit restoration clears its exception", { timeout: 30_000 }, async () => {
  await withTestUser(async ({ prisma, user }) => {
    const { createRelationshipInFamily, deleteRelationshipInFamily } = await import("@/lib/family-relationship-repository");
    const { slug, familyId, ids } = await fixture(prisma, user);
    const spouseInput = { relativePersonId: ids.dad, relationshipKind: "spouse" as const };
    await createRelationshipInFamily(slug, ids.mom, spouseInput, "Тест", user.id);
    const auto = await prisma.relationship.findFirstOrThrow({ where: { familyId, fromPersonId: ids.dad, toPersonId: ids.child, type: "parent" } });
    await deleteRelationshipInFamily(slug, ids.dad, auto.id, { expectedVersion: auto.version }, "Тест", user.id);
    await createRelationshipInFamily(slug, ids.mom, spouseInput, "Тест", user.id);
    assert.equal(await prisma.relationship.count({ where: { familyId, fromPersonId: ids.dad, toPersonId: ids.child, type: "parent" } }), 0);
    assert.equal(await prisma.parentSuppression.count({ where: { familyId, fromPersonId: ids.dad, toPersonId: ids.child } }), 1);
    await createRelationshipInFamily(slug, ids.dad, { relativePersonId: ids.child, relationshipKind: "parent" }, "Тест", user.id);
    assert.equal(await prisma.parentSuppression.count({ where: { familyId } }), 0);
    const manual = await prisma.relationship.findFirstOrThrow({ where: { familyId, fromPersonId: ids.dad, toPersonId: ids.child, type: "parent" } });
    assert.equal(manual.origin, "manual");
    assert.equal(manual.sourcePersonId, null);
  });
});

test("simultaneous relationship editors cannot overwrite one version or duplicate audit", { timeout: 30_000 }, async (t) => {
  await withTestUser(async ({ prisma, user }) => {
    const { updateRelationshipInFamily } = await import("@/lib/family-relationship-repository");
    const { slug, familyId, ids } = await fixture(prisma, user);
    const parent = await prisma.relationship.findFirstOrThrow({ where: { familyId } });
    const restore = synchronizedGraphReads(t, prisma);
    let results: PromiseSettledResult<unknown>[];
    try {
      results = await Promise.allSettled([ids.dad, ids.other].map((relativePersonId) =>
        updateRelationshipInFamily(slug, ids.mom, parent.id, { relativePersonId, relationshipKind: "spouse", expectedVersion: 0 }, "Тест", user.id)));
    } finally { restore(); }
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const failure = results.find((result) => result.status === "rejected");
    assert.equal(failure?.status, "rejected");
    if (failure?.status === "rejected") assert.equal(failure.reason instanceof HttpError && failure.reason.status === 409, true);
    assert.equal((await prisma.relationship.findUniqueOrThrow({ where: { id: parent.id } })).version, 1);
    assert.equal(await prisma.parentSuppression.count({ where: { familyId } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { familyId, action: "person_updated" } }), 1);
  });
});

test("concurrent explicit parent additions retain the two-parent constraint", { timeout: 30_000 }, async (t) => {
  await withTestUser(async ({ prisma, user }) => {
    const { createRelationshipInFamily } = await import("@/lib/family-relationship-repository");
    const { slug, familyId, ids } = await fixture(prisma, user);
    const restore = synchronizedGraphReads(t, prisma);
    let results: PromiseSettledResult<unknown>[];
    try {
      results = await Promise.allSettled([ids.dad, ids.other].map((personId) =>
        createRelationshipInFamily(slug, personId, { relativePersonId: ids.child, relationshipKind: "parent" }, "Тест", user.id)));
    } finally { restore(); }
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") assert.equal(failure.reason instanceof HttpError && failure.reason.status === 400, true);
    assert.equal(await prisma.relationship.count({ where: { familyId, toPersonId: ids.child, type: "parent" } }), 2);
    assert.equal(await prisma.auditLog.count({ where: { familyId, action: "person_updated" } }), 1);
  });
});
