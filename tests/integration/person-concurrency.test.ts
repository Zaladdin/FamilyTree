import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { Prisma, PrismaClient, User } from "@prisma/client";
import type { PersonUpdateRequest } from "@/lib/family-logic";
import { HttpError } from "@/lib/http-error";
import { disconnectTestPrisma, withTestUser } from "./helpers";
import { overrideTransaction } from "./transaction-override";

after(disconnectTestPrisma);

function barrier() {
  let arrivals = 0;
  let release!: () => void;
  let fail!: (error: Error) => void;
  let timer: NodeJS.Timeout | undefined;
  const ready = new Promise<void>((resolve, reject) => { release = resolve; fail = reject; });
  return async () => {
    arrivals += 1;
    if (arrivals === 1) timer = setTimeout(() => fail(new Error("Parallel person reads did not meet at the barrier")), 3_000);
    if (arrivals >= 2) { clearTimeout(timer); release(); }
    await ready;
  };
}

function synchronizeReads(t: TestContext, prisma: PrismaClient, delegate: "person" | "family", method: "findFirst" | "findUnique") {
  const meet = barrier();
  const reads: unknown[] = [];
  type TransactionOptions = { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number };
  const originalTransaction = prisma.$transaction.bind(prisma) as <T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>, options?: TransactionOptions,
  ) => Promise<T>;
  const coordinatedTransaction = async <T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>, options?: TransactionOptions,
  ) => originalTransaction(async (tx) => {
    // Queries and writes still execute on PostgreSQL. The proxy only pauses the
    // first two reads after completion to force overlapping old snapshots.
    const coordinatedDelegate = new Proxy(tx[delegate], {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property !== method) return value;
        const read = value as (...args: unknown[]) => Promise<unknown>;
        return async (...args: unknown[]) => {
          const result = await read.apply(target, args);
          reads.push(result);
          if (reads.length <= 2) await meet();
          return result;
        };
      },
    });
    return operation(new Proxy(tx, {
      get(target, property, receiver) {
        return property === delegate ? coordinatedDelegate : Reflect.get(target, property, receiver);
      },
    }));
  }, options);
  const restore = overrideTransaction(t, prisma, coordinatedTransaction as typeof prisma.$transaction);
  return { reads, restore };
}

async function createTwoPeople(user: User) {
  const { createFamilySpace } = await import("@/lib/family-admin-repository");
  const { createPersonInFamily } = await import("@/lib/family-repository");
  const { slug } = await createFamilySpace({
    user,
    input: { title: "Конкурентные изменения", surname: user.id, region: "Баку", description: "Disposable person fixture" },
  });
  const first = await createPersonInFamily(slug, {
    firstName: "Первый", lastName: "Тестовый", gender: "male", birthDate: "1980", birthPlace: "Баку",
    relationshipKind: "spouse", relativePersonId: "",
  }, "Тест", user.id);
  const second = await createPersonInFamily(slug, {
    firstName: "Вторая", lastName: "Тестовая", gender: "female", birthDate: "1981", birthPlace: "Баку",
    relationshipKind: "spouse", relativePersonId: first.id,
  }, "Тест", user.id);
  return { slug, first, second };
}

function assertOneConflict<T>(results: PromiseSettledResult<T>[]) {
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason instanceof HttpError);
  assert.equal(rejected[0].reason.status, 409);
}

test("parallel archives of the final two active people leave one active person and one audit", { timeout: 30_000 }, async (t) => {
  await withTestUser(async ({ prisma, user }) => {
    const { archivePersonInFamily } = await import("@/lib/family-repository");
    const { slug, first, second } = await createTwoPeople(user);
    const coordinated = synchronizeReads(t, prisma, "person", "findFirst");
    let results: PromiseSettledResult<string>[];
    try {
      results = await Promise.allSettled([first.id, second.id].map((personId) => archivePersonInFamily({
        slug, personId, actorUserId: user.id, actorName: "Тест архивирования",
      })));
    } finally { coordinated.restore(); }
    assertOneConflict(results);
    assert.equal(coordinated.reads.length >= 2, true);
    for (const read of coordinated.reads.slice(0, 2)) assert.equal((read as { isArchived: boolean }).isArchived, false);

    const family = await prisma.family.findUniqueOrThrow({ where: { slug }, include: { people: true, auditLogs: true, relationships: true } });
    assert.equal(family.peopleCount, 1);
    assert.equal(family.people.filter((person) => !person.isArchived).length, 1);
    assert.equal(family.people.filter((person) => person.isArchived).length, 1);
    assert.deepEqual(family.people.map((person) => person.version).sort(), [0, 1]);
    assert.equal(family.auditLogs.filter((audit) => audit.action === "person_archived").length, 1);
    assert.equal(family.relationships.length, 1, "archiving must retain the recorded spouse edge");
  });
});

test("parallel and repeated archive/restore of the same person change version and audit once per transition", { timeout: 30_000 }, async (t) => {
  await withTestUser(async ({ prisma, user }) => {
    const { archivePersonInFamily, restorePersonInFamily } = await import("@/lib/family-repository");
    const { slug, first } = await createTwoPeople(user);
    const params = { slug, personId: first.id, actorUserId: user.id, actorName: "Тест повтора" };
    for (const [action, archived, expectedVersion, auditAction] of [
      [archivePersonInFamily, true, 1, "person_archived"],
      [restorePersonInFamily, false, 2, "person_restored"],
    ] as const) {
      const coordinated = synchronizeReads(t, prisma, "person", "findFirst");
      let results: PromiseSettledResult<string>[];
      try { results = await Promise.allSettled([action(params), action(params)]); }
      finally { coordinated.restore(); }
      assertOneConflict(results);
      for (const read of coordinated.reads.slice(0, 2)) assert.equal((read as { isArchived: boolean }).isArchived, !archived);
      await assert.rejects(action(params), (error: unknown) => error instanceof HttpError && error.status === 409);
      const saved = await prisma.person.findUniqueOrThrow({ where: { id: first.id } });
      assert.equal(saved.isArchived, archived);
      assert.equal(saved.version, expectedVersion);
      assert.equal(await prisma.auditLog.count({ where: { familyId: saved.familyId, personId: first.id, action: auditAction } }), 1);
      const family = await prisma.family.findUniqueOrThrow({ where: { slug } });
      assert.equal(family.peopleCount, archived ? 1 : 2);
    }
  });
});

test("two editors with the same version cannot overwrite each other or append a losing audit", { timeout: 30_000 }, async (t) => {
  await withTestUser(async ({ prisma, user }) => {
    const { updatePersonInFamily } = await import("@/lib/family-repository");
    const { slug, first } = await createTwoPeople(user);
    const initial = await prisma.person.findUniqueOrThrow({ where: { id: first.id } });
    const drafts: PersonUpdateRequest[] = ["Редактор первый", "Редактор второй"].map((firstName) => ({
      firstName, lastName: "Тестовый", gender: "male", birthDate: "1980", birthPlace: "Баку", biography: firstName,
      status: "living", expectedVersion: initial.version,
    }));
    const coordinated = synchronizeReads(t, prisma, "family", "findUnique");
    let results: PromiseSettledResult<Awaited<ReturnType<typeof updatePersonInFamily>>>[];
    try {
      results = await Promise.allSettled(drafts.map((draft, index) => updatePersonInFamily(slug, first.id, draft, `Редактор ${index}`, user.id)));
    } finally { coordinated.restore(); }
    assertOneConflict(results);
    for (const read of coordinated.reads.slice(0, 2)) {
      const snapshot = read as { people: { id: string; version: number }[] };
      assert.equal(snapshot.people.find((person) => person.id === first.id)?.version, initial.version);
    }
    const winnerIndex = results.findIndex((result) => result.status === "fulfilled");
    const winner = results[winnerIndex];
    assert.equal(winner.status, "fulfilled");
    if (winner.status !== "fulfilled") throw new Error("No successful editor");
    assert.equal(winner.value.version, initial.version + 1);
    const saved = await prisma.person.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(saved.version, initial.version + 1);
    assert.equal(saved.firstName, drafts[winnerIndex].firstName);
    assert.equal(saved.biography, drafts[winnerIndex].biography);
    assert.equal(await prisma.auditLog.count({ where: { familyId: saved.familyId, personId: first.id, action: "person_updated" } }), 1);

    const loserDraft = drafts[1 - winnerIndex];
    await assert.rejects(updatePersonInFamily(slug, first.id, loserDraft, "Повтор старой карточки", user.id),
      (error: unknown) => error instanceof HttpError && error.status === 409);
    assert.deepEqual(await prisma.person.findUniqueOrThrow({ where: { id: first.id } }), saved);
    assert.equal(await prisma.auditLog.count({ where: { familyId: saved.familyId, personId: first.id, action: "person_updated" } }), 1);
  });
});
