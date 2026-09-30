import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { Prisma } from "@prisma/client";
import type { AddPersonInput } from "@/lib/family-logic";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";

// Seed the existing singleton before loading the repository. No PrismaClient
// is constructed; even direct test-file runs have a closed database fallback.
const previousDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = UNIT_DATABASE_URL;
const globalForPrisma = globalThis as { prisma?: unknown };
const previousPrisma = globalForPrisma.prisma;
async function unexpectedDatabaseCall(..._args: unknown[]): Promise<never> {
  throw new Error("Unexpected database operation in create-person unit test");
}
const prisma = {
  family: { findUnique: unexpectedDatabaseCall },
  $transaction: unexpectedDatabaseCall,
};
globalForPrisma.prisma = prisma;
after(() => {
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  if (previousPrisma === undefined) delete globalForPrisma.prisma;
  else globalForPrisma.prisma = previousPrisma;
});
const requireFromTest = createRequire(path.resolve("tests/create-person-repository.test.ts"));
assert.equal(requireFromTest("../lib/prisma").prisma === prisma, true);
const { createPersonInFamily: persistPerson }: typeof import("../lib/family-repository") = requireFromTest("../lib/family-repository");
const createPersonInFamily = (slug: string, input: AddPersonInput, actorName = "Система") =>
  persistPerson(slug, input, actorName, "unit-actor");

function rawPerson(id: string, firstName: string, isArchived = false) {
  return {
    id, firstName, isArchived, familyId: "unit-family", lastName: "Тестовые", middleName: "",
    gender: "male", birthDate: "1990", birthPlace: "Баку", status: "living",
    biography: "", note: null, deathDate: null,
    photosCount: 0, audioCount: 0, documentsCount: 0,
    memoryTitle: null, memoryNarrator: null, memoryDuration: null, memorySummary: null,
    createdAt: new Date(0), updatedAt: new Date(0),
  };
}
type Edge = { type: "parent" | "spouse" | "sibling"; fromPersonId: string; toPersonId: string };
function rawFamily() {
  return {
    id: "unit-family", slug: "unit-family", title: "Тестовые", surname: "Тестовые",
    description: "", region: "", coverQuote: "", peopleCount: 2,
    photosCount: 0, audioCount: 0, storiesCount: 0, contributorsCount: 1,
    memberships: [], digitizationTasks: [], auditLogs: [],
    people: [rawPerson("father", "Отец"), rawPerson("child", "Ребёнок")],
    relationships: [{ type: "parent", fromPersonId: "father", toPersonId: "child" }] as Edge[],
    parentSuppressions: [] as { fromPersonId: string; toPersonId: string }[],
  };
}
type FamilyRecord = ReturnType<typeof rawFamily>;
type PersonWrite = { id: string; familyId: string; firstName: string; [key: string]: unknown };
type RelationWrite = Edge & { familyId: string };
type Writes = { people: PersonWrite[]; relationships: RelationWrite[]; audits: Record<string, unknown>[]; stats: Record<string, unknown>[] };
function emptyWrites(): Writes { return { people: [], relationships: [], audits: [], stats: [] }; }
function conflict(code = "P2034") {
  return new Prisma.PrismaClientKnownRequestError("Synthetic transaction conflict", { code, clientVersion: "unit" });
}

function installDatabase(t: TestContext, options: {
  family?: FamilyRecord | null;
  personIds?: Set<string>;
  failRelationships?: boolean;
  failCommit?: (attempt: number, family: FamilyRecord, pending: Writes) => Error | undefined;
} = {}) {
  const state = {
    family: options.family === undefined ? rawFamily() : structuredClone(options.family),
    attempts: 0, reads: 0, active: false, events: [] as string[], committed: emptyWrites(), pending: [] as Writes[],
  };
  const transaction = t.mock.method(prisma, "$transaction", async (
    callback: (transaction: unknown) => Promise<unknown>,
    transactionOptions: { isolationLevel: string },
  ) => {
    assert.equal(transactionOptions.isolationLevel, "Serializable");
    assert.equal(state.active, false);
    state.active = true;
    state.attempts += 1;
    state.events.push("begin");
    const pending = emptyWrites();
    state.pending.push(pending);
    const record = structuredClone(state.family);
    function event(name: string) {
      assert.equal(state.active, true, "all reads and writes must stay inside the transaction");
      state.events.push(name);
    }
    const tx = {
      family: {
        findUnique: async ({ where, include }: { where: { slug: string }; include: Record<string, unknown> }) => {
          event("read"); state.reads += 1;
          assert.equal(where.slug, record?.slug ?? "unit-family");
          assert.equal(include.relationships, true);
          assert.ok(include.people);
          return record;
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          event("stats"); assert.equal(where.id, record?.id); pending.stats.push(data); return data;
        },
      },
      person: {
        create: async ({ data }: { data: PersonWrite }) => {
          if (options.personIds?.has(data.id) || pending.people.some((person) => person.id === data.id)) {
            throw conflict("P2002");
          }
          event("person"); pending.people.push(data); return data;
        },
        count: async () => { event("count-person"); return (record?.people.filter((person) => !person.isArchived).length ?? 0) + pending.people.length; },
      },
      relationship: { createMany: async ({ data }: { data: RelationWrite[] }) => {
        event("relationships");
        if (options.failRelationships) throw new Error("Synthetic relationship write failure");
        pending.relationships.push(...data); return { count: data.length };
      } },
      mediaAsset: { count: async () => { event("count-media"); return 0; } },
      story: { count: async () => { event("count-story"); return 0; } },
      familyMembership: {
        count: async () => { event("count-membership"); return 1; },
        findFirst: async ({ where }: { where: { familyId: string; userId: string } }) => {
          assert.equal(state.active, true);
          assert.deepEqual(where, { familyId: record?.id, userId: "unit-actor" });
          return { role: "editor" };
        },
      },
      auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => {
        event("audit"); pending.audits.push(data); return data;
      } },
    };
    try {
      const result = await callback(tx);
      if (state.family) {
        const failure = options.failCommit?.(state.attempts, state.family, pending);
        if (failure) throw failure;
      }
      for (const key of ["people", "relationships", "audits", "stats"] as const) {
        // The fake publishes staged writes only on a successful commit.
        (state.committed[key] as unknown[]).push(...pending[key]);
      }
      for (const person of pending.people) options.personIds?.add(person.id);
      state.events.push("commit");
      return result;
    } catch (error) {
      state.events.push("rollback");
      throw error;
    } finally { state.active = false; }
  });
  return { state, transaction };
}

const motherInput: AddPersonInput = {
  firstName: "  Мама ", lastName: " Тестовая ", middleName: " Тестовна ", gender: "female",
  birthDate: "1972", birthPlace: " Баку ", biography: " История семьи ",
  relationshipKind: "spouse", relativePersonId: "father", sharedChildIds: ["child"],
};

test("single creation saves automatic spouse parenthood with provenance", async (t) => {
  const { state } = installDatabase(t);
  const person = await createPersonInFamily("unit-family", { ...motherInput, sharedChildIds: [], additionalRelationships: [] });
  const inferred = state.committed.relationships.find((r) => r.type === "parent" && r.fromPersonId === person.id);
  assert.ok(inferred, "the spouse becomes the child's second parent by default");
  assert.equal((inferred as unknown as { origin: string }).origin, "spouse");
  assert.equal((inferred as unknown as { sourcePersonId: string }).sourcePersonId, "father");
  assert.equal(inferred.toPersonId, "child");
  assert.ok(state.committed.audits.some((entry) => String(entry.message).includes("автоматически")));
});

test("single creation retains stored suppressions during inference through siblings", async (t) => {
  const family = rawFamily();
  family.people.push(rawPerson("sibling", "Сестра"));
  family.relationships.push({ type: "sibling", fromPersonId: "child", toPersonId: "sibling" });
  family.parentSuppressions.push({ fromPersonId: "father", toPersonId: "sibling" });
  const { state } = installDatabase(t, { family });
  await createPersonInFamily("unit-family", { ...motherInput, sharedChildIds: [] });
  assert.equal(state.committed.relationships.some((r) => r.type === "parent" && r.fromPersonId === "father" && r.toPersonId === "sibling"), false);
});

test("identical people in independent families receive distinct database IDs and retain legacy edge endpoints", async (t) => {
  const otherFamily = rawFamily();
  otherFamily.id = otherFamily.slug = "other-family";
  otherFamily.people = otherFamily.people.map((person) => ({ ...person, id: `other-${person.id}`, familyId: otherFamily.id }));
  otherFamily.relationships = [{ type: "parent", fromPersonId: "other-father", toPersonId: "other-child" }];
  const personIds = new Set(["father", "child", "other-father", "other-child"]);
  const { state } = installDatabase(t, { personIds });
  const first = await createPersonInFamily("unit-family", motherInput);
  state.family = otherFamily;
  const second = await createPersonInFamily("other-family", {
    ...motherInput, relativePersonId: "other-father", sharedChildIds: ["other-child"],
  });

  assert.notEqual(first.id, second.id);
  assert.equal(state.attempts, 2, "each family's creation commits on its first attempt");
  assert.deepEqual(state.committed.people.map(({ id, familyId }) => ({ id, familyId })), [
    { id: first.id, familyId: "unit-family" }, { id: second.id, familyId: "other-family" },
  ]);
  assert.deepEqual(state.committed.relationships.slice(2), [
    { familyId: "other-family", type: "spouse", fromPersonId: "other-father", toPersonId: second.id },
    { familyId: "other-family", type: "parent", fromPersonId: second.id, toPersonId: "other-child" },
  ]);
  assert.deepEqual(state.committed.audits.map((audit) => audit.personId), [first.id, second.id]);
  assert.deepEqual(otherFamily.people.map((person) => person.id), ["other-father", "other-child"]);
});

test("creation persists deceased status and date in the same mocked transaction", async (t) => {
  const { state } = installDatabase(t);
  const person = await createPersonInFamily("unit-family", { ...motherInput, status: "deceased", deathDate: "2020-06-01" });
  assert.equal(person.status, "deceased");
  assert.equal(person.deathDate, "2020-06-01");
  assert.equal(state.committed.people[0].status, "deceased");
  assert.equal(state.committed.people[0].deathDate, "2020-06-01");
});

test("UUID persistence retains same-family duplicate rejection before writes", async (t) => {
  const family = rawFamily();
  family.people.push({
    ...rawPerson("legacy-mother-id", "Мама"), lastName: "Тестовая", middleName: "Тестовна", birthDate: "1972",
  });
  const { state } = installDatabase(t, { family });
  await assert.rejects(createPersonInFamily("unit-family", motherInput), /уже есть в этой семье/);
  assert.deepEqual(state.events, ["begin", "read", "rollback"]);
  assert.deepEqual(state.committed, emptyWrites());
});

test("person creation reads the graph in a serializable transaction and commits mother, shared-child edges, stats and audit together", async (t) => {
  const { state } = installDatabase(t);
  const person = await createPersonInFamily("unit-family", motherInput, "Автор");
  assert.deepEqual(state.events.slice(0, 4), ["begin", "read", "person", "relationships"]);
  assert.equal(state.events.at(-1), "commit");
  assert.equal(state.reads, 1);
  assert.equal(state.committed.people.length, 1);
  assert.deepEqual(state.committed.relationships, [
    { familyId: "unit-family", type: "spouse", fromPersonId: "father", toPersonId: person.id },
    { familyId: "unit-family", type: "parent", fromPersonId: person.id, toPersonId: "child" },
  ]);
  assert.deepEqual(state.committed.people[0], {
    id: person.id, familyId: "unit-family", firstName: "Мама", lastName: "Тестовая", middleName: "Тестовна",
    gender: "female", birthDate: "1972", deathDate: null, birthPlace: "Баку", status: "living", isArchived: false,
    biography: "История семьи", note: person.note, photosCount: 0, audioCount: 0, documentsCount: 0,
    memoryTitle: null, memoryNarrator: null, memoryDuration: null, memorySummary: null,
    timelineEvents: { create: [{ label: `${new Date().getFullYear()} - добавлен(а) в цифровое дерево семьи`, order: 0, kind: "custom" }] },
  });
  assert.deepEqual(state.committed.stats, [{ peopleCount: 3, photosCount: 0, audioCount: 0, storiesCount: 0, contributorsCount: 1 }]);
  assert.equal(state.committed.audits.length, 1);
  assert.equal(state.committed.audits[0].action, "person_created");
  assert.equal(state.committed.audits[0].actorName, "Автор");
  assert.equal(state.committed.audits[0].personId, person.id);
});

test("invalid shared-child selection writes no person, edges, stats or audit", async (t) => {
  const { state } = installDatabase(t);
  await assert.rejects(createPersonInFamily("unit-family", { ...motherInput, sharedChildIds: ["unrelated"] }), /существующих детей/);
  assert.deepEqual(state.events, ["begin", "read", "rollback"]);
  assert.deepEqual(state.committed, emptyWrites());
  assert.deepEqual(state.pending[0], emptyWrites());
});

test("a failed edge write rolls back the new person instead of leaving an unlinked card", async (t) => {
  const { state } = installDatabase(t, { failRelationships: true });
  await assert.rejects(createPersonInFamily("unit-family", motherInput), /Synthetic relationship/);
  assert.equal(state.pending[0].people.length, 1);
  assert.equal(state.attempts, 1, "ordinary write errors must not retry");
  assert.deepEqual(state.committed, emptyWrites());
  assert.equal(state.events.at(-1), "rollback");
});

test("conflict retry reads the fresh graph and refuses a third parent added concurrently", async (t) => {
  const { state } = installDatabase(t, { failCommit: (attempt, family) => {
    if (attempt !== 1) return;
    family.people.push(rawPerson("other-parent", "Другой родитель"));
    family.relationships.push({ type: "parent", fromPersonId: "other-parent", toPersonId: "child" });
    return conflict();
  } });
  await assert.rejects(createPersonInFamily("unit-family", motherInput), /существующих детей/);
  assert.equal(state.attempts, 2);
  assert.equal(state.reads, 2);
  assert.equal(state.pending[0].people.length, 1);
  assert.deepEqual(state.pending[1], emptyWrites());
  assert.deepEqual(state.committed, emptyWrites());
});

test("an archived existing parent still occupies a parent slot", async (t) => {
  const family = rawFamily();
  family.people.push(rawPerson("archived-parent", "Архивный родитель", true));
  family.relationships.push({ type: "parent", fromPersonId: "archived-parent", toPersonId: "child" });
  const { state } = installDatabase(t, { family });
  await assert.rejects(createPersonInFamily("unit-family", motherInput), /существующих детей/);
  assert.deepEqual(state.pending[0], emptyWrites());
  assert.deepEqual(state.committed, emptyWrites());
});

test("ordinary child creation keeps both previously supported parent links", async (t) => {
  const family = rawFamily();
  family.people.push(rawPerson("mother", "Мать"));
  family.relationships.push({ type: "spouse", fromPersonId: "father", toPersonId: "mother" });
  const { state } = installDatabase(t, { family });
  const person = await createPersonInFamily("unit-family", {
    firstName: "Дочь", lastName: "Тестовая", gender: "female", birthDate: "2026", birthPlace: "Баку",
    relationshipKind: "child", relativePersonId: "father",
  });
  assert.deepEqual(state.committed.relationships, [
    { familyId: "unit-family", type: "parent", fromPersonId: "father", toPersonId: person.id },
    { familyId: "unit-family", type: "parent", fromPersonId: "mother", toPersonId: person.id, origin: "spouse", sourcePersonId: "father" },
  ]);
  assert.equal(state.committed.people.length, 1);
});

test("unique-ID conflicts retry against the refreshed family and choose an unused ID", async (t) => {
  let firstId = "";
  const { state } = installDatabase(t, { failCommit: (attempt, family, pending) => {
    if (attempt !== 1) return;
    firstId = pending.people[0].id;
    family.people.push(rawPerson(firstId, "Другая карточка"));
    return conflict("P2002");
  } });
  const person = await createPersonInFamily("unit-family", motherInput);
  assert.equal(state.attempts, 2);
  assert.equal(state.reads, 2);
  assert.notEqual(person.id, firstId);
  assert.equal(state.committed.people.length, 1);
  assert.equal(state.committed.people[0].id, person.id);
  assert.equal(state.committed.audits.length, 1);
});

test("serialization retries are bounded and leave no committed records", async (t) => {
  const { state } = installDatabase(t, { failCommit: () => conflict() });
  await assert.rejects(createPersonInFamily("unit-family", motherInput), (error: unknown) => {
    assert.equal((error as { status: number }).status, 409);
    assert.match((error as Error).message, /одновременно/);
    return true;
  });
  assert.equal(state.attempts, 3);
  assert.equal(state.reads, 3);
  assert.deepEqual(state.committed, emptyWrites());
});

test("missing families are rejected inside the transaction before writes", async (t) => {
  const { state } = installDatabase(t, { family: null });
  await assert.rejects(createPersonInFamily("unit-family", motherInput), /Семья не найдена/);
  assert.deepEqual(state.events, ["begin", "read", "rollback"]);
  assert.deepEqual(state.committed, emptyWrites());
});

test("single creation commits a direct sibling with explicit parent links atomically", async (t) => {
  const { state } = installDatabase(t);
  const person = await createPersonInFamily("unit-family", {
    ...motherInput, relationshipKind: "sibling", relativePersonId: "child", sharedChildIds: [],
    additionalRelationships: [{ relationshipKind: "child", relativePersonId: "father" }],
  });
  assert.deepEqual(state.committed.relationships, [
    { familyId: "unit-family", type: "sibling", fromPersonId: person.id, toPersonId: "child" },
    { familyId: "unit-family", type: "parent", fromPersonId: "father", toPersonId: person.id },
  ]);
  assert.equal(state.committed.people.length, 1);
  assert.equal(state.committed.audits.length, 1);
});

test("invalid additional relationship rolls back single creation before any writes", async (t) => {
  const { state } = installDatabase(t);
  await assert.rejects(createPersonInFamily("unit-family", {
    ...motherInput, additionalRelationships: [{ relationshipKind: "parent", relativePersonId: "foreign-family-person" }],
  }), /Оба человека/);
  assert.deepEqual(state.events, ["begin", "read", "rollback"]);
  assert.deepEqual(state.pending[0], emptyWrites());
  assert.deepEqual(state.committed, emptyWrites());
});
