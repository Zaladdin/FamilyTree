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
  const { slug } = await createFamilySpace({ user, input: { title: "Истории", surname: user.id, region: "Баку", description: "Disposable story fixture" } });
  const family = await prisma.family.findUniqueOrThrow({ where: { slug } });
  const person = await prisma.person.create({ data: {
    id: randomUUID(), familyId: family.id, firstName: "Тест", lastName: "Рассказчик", gender: "male", birthDate: "1980", birthPlace: "Баку", status: "living", biography: "",
  } });
  return { familyId: family.id, params: { slug, personId: person.id, actorUserId: user.id, actorName: "Тест Редактор" } };
}

function synchronizeStoryReads(t: TestContext, prisma: PrismaClient) {
  let reads = 0;
  let release!: () => void;
  let reject!: (error: Error) => void;
  let timer: NodeJS.Timeout | undefined;
  const barrier = new Promise<void>((resolve, fail) => { release = resolve; reject = fail; });
  const original = prisma.$transaction.bind(prisma) as <T>(
    run: (tx: Prisma.TransactionClient) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ) => Promise<T>;
  const coordinated = async <T>(run: (tx: Prisma.TransactionClient) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }) =>
    original(async (tx) => {
      const story = new Proxy(tx.story, { get(target, property, receiver) {
        if (property !== "findFirst") return Reflect.get(target, property, receiver);
        return async (...args: Parameters<typeof tx.story.findFirst>) => {
          const result = await tx.story.findFirst(...args);
          reads += 1;
          if (reads === 1) timer = setTimeout(() => reject(new Error("Concurrent story reads did not reach barrier")), 3000);
          if (reads === 2) { clearTimeout(timer); release(); }
          if (reads <= 2) await barrier;
          return result;
        };
      } });
      return run(new Proxy(tx, { get(target, property, receiver) { return property === "story" ? story : Reflect.get(target, property, receiver); } }));
    }, options);
  const restore = overrideTransaction(t, prisma, coordinated as typeof prisma.$transaction);
  return () => { clearTimeout(timer); restore(); };
}

function assertOneConflict(results: PromiseSettledResult<unknown>[]) {
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const failure = results.find((result) => result.status === "rejected");
  assert.ok(failure?.status === "rejected" && failure.reason instanceof HttpError && failure.reason.status === 409);
}

test("story lifecycle preserves paragraphs, versions and counters excluding archived or deleted content", { timeout: 30_000 }, async () => {
  await withTestUser(async ({ prisma, user }) => {
    const { createStoryForPerson, updateStoryForPerson, deleteStoryForPerson, restoreStoryForPerson } = await import("@/lib/family-story-repository");
    const { familyId, params } = await fixture(prisma, user);
    const archived = await prisma.person.create({ data: {
      id: randomUUID(), familyId, firstName: "Архивный", lastName: "Рассказчик", gender: "male", birthDate: "1950", birthPlace: "Баку", status: "living", biography: "", isArchived: true,
    } });
    await prisma.story.create({ data: { personId: archived.id, title: "Архивный рассказ", body: "Архивный текст" } });
    const created = await createStoryForPerson({ ...params, title: "Рассказ", body: "Первый абзац\r\n\r\nВторой абзац" });
    assert.equal(created.body, "Первый абзац\n\nВторой абзац");
    const updated = await updateStoryForPerson({ ...params, storyId: created.id, expectedVersion: 0, title: "Исправленный рассказ", body: "Новый абзац\n\nВторой абзац" });
    assert.equal(updated.version, 1);
    assert.equal(updated.createdAt, created.createdAt);
    assert.equal((await prisma.family.findUniqueOrThrow({ where: { id: familyId } })).storiesCount, 1);
    await deleteStoryForPerson({ ...params, storyId: created.id, expectedVersion: 1 });
    assert.equal((await prisma.family.findUniqueOrThrow({ where: { id: familyId } })).storiesCount, 0);
    const deleted = await prisma.story.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(deleted.version, 2); assert.ok(deleted.deletedAt); assert.equal(deleted.body, updated.body);
    const restored = await restoreStoryForPerson({ ...params, storyId: created.id, expectedVersion: 2 });
    assert.equal(restored.version, 3); assert.equal(restored.deletedAt, undefined);
    assert.equal((await prisma.family.findUniqueOrThrow({ where: { id: familyId } })).storiesCount, 1);
    const audits = await prisma.auditLog.findMany({ where: { familyId, personId: params.personId } });
    assert.deepEqual(audits.map((entry) => entry.action).sort(), ["story_added", "story_deleted", "story_restored", "story_updated"]);
    assert.doesNotMatch(JSON.stringify(audits), /Первый абзац|Второй абзац|Новый абзац/);
  });
});

test("competing story edit and delete cannot overwrite the same version", { timeout: 30_000 }, async (t) => {
  await withTestUser(async ({ prisma, user }) => {
    const { createStoryForPerson, updateStoryForPerson, deleteStoryForPerson } = await import("@/lib/family-story-repository");
    const { familyId, params } = await fixture(prisma, user);
    const created = await createStoryForPerson({ ...params, title: "Рассказ", body: "Исходный текст" });
    const restore = synchronizeStoryReads(t, prisma);
    let results: PromiseSettledResult<unknown>[];
    try {
      results = await Promise.allSettled([
        updateStoryForPerson({ ...params, storyId: created.id, expectedVersion: 0, title: "Изменённый рассказ", body: "Новый текст" }),
        deleteStoryForPerson({ ...params, storyId: created.id, expectedVersion: 0 }),
      ]);
    } finally { restore(); }
    assertOneConflict(results);
    const saved = await prisma.story.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(saved.version, 1);
    const edited = results[0].status === "fulfilled";
    assert.equal(saved.body, edited ? "Новый текст" : "Исходный текст");
    assert.equal(saved.deletedAt === null, edited);
    assert.equal((await prisma.family.findUniqueOrThrow({ where: { id: familyId } })).storiesCount, edited ? 1 : 0);
    assert.equal(await prisma.auditLog.count({ where: { familyId, action: { in: ["story_updated", "story_deleted"] } } }), 1);
  });
});

test("simultaneous story restoration increments version and active counter once", { timeout: 30_000 }, async (t) => {
  await withTestUser(async ({ prisma, user }) => {
    const { createStoryForPerson, deleteStoryForPerson, restoreStoryForPerson } = await import("@/lib/family-story-repository");
    const { familyId, params } = await fixture(prisma, user);
    const created = await createStoryForPerson({ ...params, title: "Рассказ", body: "Исходный текст" });
    await deleteStoryForPerson({ ...params, storyId: created.id, expectedVersion: 0 });
    const restore = synchronizeStoryReads(t, prisma);
    let results: PromiseSettledResult<unknown>[];
    try {
      results = await Promise.allSettled([1, 2].map(() => restoreStoryForPerson({ ...params, storyId: created.id, expectedVersion: 1 })));
    } finally { restore(); }
    assertOneConflict(results);
    const saved = await prisma.story.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(saved.version, 2); assert.equal(saved.deletedAt, null);
    assert.equal((await prisma.family.findUniqueOrThrow({ where: { id: familyId } })).storiesCount, 1);
    assert.equal(await prisma.auditLog.count({ where: { familyId, action: "story_restored" } }), 1);
  });
});
