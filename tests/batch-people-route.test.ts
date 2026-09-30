import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { Prisma } from "@prisma/client";
import type { BatchPersonEntry } from "@/lib/family-batch";
import type { FamilyRelationship, FamilyRole } from "@/lib/types";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";

// A closed fake is installed before importing the route/repository. No real
// PrismaClient, private family data or external database is used in this suite.
const previousDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = UNIT_DATABASE_URL;
const globalForPrisma = globalThis as { prisma?: unknown };
const previousPrisma = globalForPrisma.prisma;
const unexpected = async (..._args: unknown[]): Promise<unknown> => { throw new Error("Unexpected batch database call"); };
const prisma = { session: { findUnique: unexpected }, familyMembership: { findFirst: unexpected }, $transaction: unexpected };
globalForPrisma.prisma = prisma;
after(() => {
  if (previousPrisma === undefined) delete globalForPrisma.prisma;
  else globalForPrisma.prisma = previousPrisma;
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});
const requireFromTest = createRequire(path.resolve("tests/batch-people-route.test.ts"));
const nextHeaders: typeof import("next/headers") = requireFromTest("next/headers");
assert.equal(requireFromTest("../lib/prisma").prisma, prisma);
const { POST }: typeof import("../app/api/family/[slug]/people/batch/route") = requireFromTest("../app/api/family/[slug]/people/batch/route");
const { POST: singlePOST }: typeof import("../app/api/family/[slug]/people/route") = requireFromTest("../app/api/family/[slug]/people/route");

function sampleFamily() {
  return {
    id: "unit-family", slug: "unit-family", title: "Тестовые", surname: "Тестовые", description: "", region: "", coverQuote: "",
    peopleCount: 0, photosCount: 0, audioCount: 0, storiesCount: 0, contributorsCount: 1,
    memberships: [], digitizationTasks: [], auditLogs: [],
    people: [] as Record<string, unknown>[], relationships: [] as FamilyRelationship[],
  };
}
type Writes = { people: Record<string, unknown>[]; edges: Record<string, unknown>[]; audits: Record<string, unknown>[]; stats: Record<string, unknown>[] };
const noWrites = (): Writes => ({ people: [], edges: [], audits: [], stats: [] });
const conflict = (code: string) => new Prisma.PrismaClientKnownRequestError("Internal conflict details", { code, clientVersion: "unit" });

function fakes(t: TestContext, options: {
  role?: FamilyRole | null; loggedIn?: boolean; missingFamily?: boolean;
  failAt?: "person" | "edges" | "audit" | "stats";
  conflictCode?: string; conflictCount?: number; concurrentParent?: boolean;
  single?: boolean; failError?: Error;
  transactionRole?: (attempt: number) => FamilyRole | null;
} = {}) {
  const family = sampleFamily();
  const cookieRead = t.mock.method(nextHeaders, "cookies", async () => ({ get: () => options.loggedIn === false ? undefined : { value: "unit-cookie" } }));
  const sessionRead = t.mock.method(prisma.session, "findUnique", async () => ({ expiresAt: new Date(Date.now() + 60_000), user: { id: "unit-actor", firstName: "Редактор", lastName: "Тестовый" } }));
  const roleRead = t.mock.method(prisma.familyMembership, "findFirst", async () => options.role === null ? null : { role: options.role ?? "editor" });
  const committed = noWrites();
  const attempts: Writes[] = [];
  const reads: unknown[] = [];
  const transactionRoleReads: unknown[] = [];
  const transaction = t.mock.method(prisma, "$transaction", async (callback: (tx: unknown) => Promise<unknown>, settings: unknown) => {
    assert.deepEqual(settings, options.single ? { isolationLevel: "Serializable" } : { isolationLevel: "Serializable", maxWait: 5000, timeout: 20000 });
    const pending = noWrites();
    attempts.push(pending);
    const fail = (stage: typeof options.failAt) => { if (stage === options.failAt) throw options.failError ?? new Error("private Prisma internal details"); };
    const result = await callback({
      family: {
        findUnique: async (query: unknown) => { reads.push(query); return options.missingFamily ? null : structuredClone(family); },
        update: async ({ data }: { data: Record<string, unknown> }) => { fail("stats"); pending.stats.push(data); return data; },
      },
      person: {
        create: async ({ data }: { data: Record<string, unknown> }) => { if (pending.people.length === 1) fail("person"); pending.people.push(data); return data; },
        count: async () => family.people.filter((person) => !person.isArchived).length + pending.people.length,
      },
      relationship: { createMany: async ({ data }: { data: Record<string, unknown>[] }) => { fail("edges"); pending.edges.push(...data); return { count: data.length }; } },
      auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { fail("audit"); pending.audits.push(data); return data; } },
      mediaAsset: { count: async () => 0 }, story: { count: async () => 0 },
      familyMembership: {
        count: async () => 1,
        findFirst: async (query: unknown) => {
          transactionRoleReads.push(query);
          const role = options.transactionRole ? options.transactionRole(attempts.length) : options.role ?? "editor";
          return role === null ? null : { role };
        },
      },
    });
    if (attempts.length <= (options.conflictCount ?? 0)) {
      if (options.concurrentParent) {
        const parent = pending.people[0];
        family.people.push({ ...parent, timelineEvents: undefined });
      }
      throw conflict(options.conflictCode ?? "P2034");
    }
    for (const key of ["people", "edges", "audits", "stats"] as const) committed[key].push(...pending[key]);
    return result;
  });
  return { family, cookieRead, sessionRead, roleRead, transaction, committed, attempts, reads, transactionRoleReads };
}

const origin = "http://127.0.0.1:3000";
const entries: BatchPersonEntry[] = [
  { clientId: "parent", firstName: "Родитель", lastName: "Тестовый", middleName: "Тестович", gender: "male", birthDate: "1950", birthPlace: "Баку", relationshipKind: "parent", relativePersonId: "", status: "deceased", deathDate: "2020" },
  { clientId: "child", firstName: "Ребёнок", lastName: "Тестовый", gender: "male", birthDate: "1980", birthPlace: "Баку", relationshipKind: "child", relativePersonId: "", relativeClientId: "parent" },
];

test("batch persists automatic edge provenance with remapped source UUID and returns warnings", async (t) => {
  const state = fakes(t);
  const rows: BatchPersonEntry[] = [
    { ...entries[0], status: "living", deathDate: "" },
    { ...entries[1], clientId: "spouse", firstName: "Супруга", gender: "female", birthDate: "1955", relationshipKind: "spouse" },
    { ...entries[1], firstName: "Ребёнок" },
  ];
  const response = await POST(request(rows), context());
  assert.equal(response.status, 200);
  const body = await response.json();
  const [parentId, spouseId, childId] = body.personIds;
  const automatic = state.committed.edges.find((r) => r.fromPersonId === spouseId && r.toPersonId === childId && r.type === "parent");
  assert.ok(automatic);
  assert.equal(automatic.origin, "spouse");
  assert.equal(automatic.sourcePersonId, parentId, "provenance must not retain a planner-local slug");
  assert.deepEqual(body.warnings, []);
  assert.ok(state.committed.audits.some((entry) => String(entry.message).includes("автоматически")));
});

test("batch returns named ambiguity warnings while saving the valid explicit family", async (t) => {
  const state = fakes(t);
  const rows: BatchPersonEntry[] = [
    { ...entries[0], status: "living", deathDate: "" },
    { ...entries[1], clientId: "spouse1", firstName: "Первая", birthDate: "1955", relationshipKind: "spouse" },
    { ...entries[1], clientId: "spouse2", firstName: "Вторая", birthDate: "1956", relationshipKind: "spouse" },
    { ...entries[1], firstName: "Ребёнок" },
  ];
  const response = await POST(request(rows), context());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.warnings.length > 0);
  assert.match(body.warnings.join(" "), /Ребёнок/);
  assert.equal(state.committed.edges.filter((edge) => edge.type === "parent").length, 1);
});
const context = () => ({ params: Promise.resolve({ slug: "unit-family" }) });
const request = (people: unknown = entries, requestOrigin = origin) => new Request(`${origin}/api/family/unit-family/people/batch`, {
  method: "POST", headers: { origin: requestOrigin, host: "127.0.0.1:3000", "content-type": "application/json" }, body: JSON.stringify({ people }),
});

for (const single of [true, false]) {
  test(`${single ? "single" : "batch"} rechecks revoked editor rights after body parsing before any write`, async (t) => {
    const state = fakes(t, { single, transactionRole: () => "member" });
    const req = single ? new Request(`${origin}/api/family/unit-family/people`, {
      method: "POST", headers: { origin }, body: JSON.stringify(entries[0]),
    }) : request();
    const response = await (single ? singlePOST : POST)(req, context());
    assert.equal(response.status, 403);
    assert.equal(state.roleRead.mock.callCount(), 1);
    assert.deepEqual(state.transactionRoleReads, [{ where: { familyId: "unit-family", userId: "unit-actor" }, select: { role: true } }]);
    assert.deepEqual(state.committed, noWrites());
    assert.deepEqual(state.attempts[0], noWrites());
  });

  test(`${single ? "single" : "batch"} rechecks membership on serialization retry and aborts when it is removed`, async (t) => {
    const state = fakes(t, { single, conflictCount: 1, transactionRole: (attempt) => attempt === 1 ? "editor" : null });
    const req = single ? new Request(`${origin}/api/family/unit-family/people`, {
      method: "POST", headers: { origin }, body: JSON.stringify(entries[0]),
    }) : request();
    const response = await (single ? singlePOST : POST)(req, context());
    assert.equal(response.status, 403);
    assert.equal(state.roleRead.mock.callCount(), 1);
    assert.equal(state.transactionRoleReads.length, 2);
    assert.ok(state.attempts[0].people.length > 0, "the conflicted attempt staged writes but did not commit");
    assert.deepEqual(state.attempts[1], noWrites());
    assert.deepEqual(state.committed, noWrites());
  });
}

for (const role of ["owner", "admin", "editor"] as const) {
  test(`batch POST permits ${role} and atomically writes people, draft edges, audit and one stats update`, async (t) => {
    const state = fakes(t, { role });
    const response = await POST(request(), context());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.personIds.length, 2);
    assert.equal(body.personId, body.personIds[0]);
    assert.deepEqual(Object.keys(body).sort(), ["message", "personId", "personIds", "warnings"]);
    assert.deepEqual(body.warnings, []);
    assert.equal(state.reads.length, 1);
    assert.deepEqual((state.reads[0] as { where: unknown }).where, { slug: "unit-family" });
    assert.deepEqual(state.roleRead.mock.calls[0].arguments[0], { where: { family: { slug: "unit-family" }, userId: "unit-actor" }, select: { role: true } });
    assert.equal(state.committed.people.length, 2);
    assert.equal(state.committed.people[0].middleName, "Тестович");
    assert.equal(state.committed.people[0].status, "deceased");
    assert.equal(state.committed.people[0].deathDate, "2020");
    assert.ok(body.personIds.every((id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)));
    assert.deepEqual(state.committed.people.map((person) => person.id), body.personIds);
    assert.deepEqual(state.committed.audits.map((audit) => audit.personId), body.personIds);
    assert.ok(state.committed.people.every((person) => person.familyId === "unit-family" && person.timelineEvents));
    assert.deepEqual(state.committed.edges, [{ familyId: "unit-family", type: "parent", fromPersonId: body.personIds[0], toPersonId: body.personIds[1] }]);
    assert.equal(state.committed.audits.length, 2);
    assert.ok(state.committed.audits.every((audit) => audit.actorName === "Редактор Тестовый" && audit.action === "person_created"));
    assert.deepEqual(state.committed.stats, [{ peopleCount: 2, photosCount: 0, audioCount: 0, storiesCount: 0, contributorsCount: 1 }]);
  });
}

for (const role of ["guest", "member", null] as const) {
  test(`batch POST denies ${role ?? "nonmember"} before parsing or mutation`, async (t) => {
    const state = fakes(t, { role });
    const req = request();
    assert.equal((await POST(req, context())).status, 403);
    assert.equal(req.bodyUsed, false);
    assert.equal(state.transaction.mock.callCount(), 0);
  });
}

test("batch commits father, mother, two paternal sisters and explicit shared child links with remapped IDs", async (t) => {
  const state = fakes(t);
  const base = entries[0];
  const people: BatchPersonEntry[] = [
    { ...base, clientId: "father", firstName: "Отец", additionalRelationships: [] },
    { ...base, clientId: "mother", firstName: "Мать", gender: "female", relationshipKind: "spouse", relativeClientId: "father", additionalRelationships: [] },
    { ...base, clientId: "aunt1", firstName: "Тётя1", gender: "female", relationshipKind: "sibling", relativeClientId: "father", additionalRelationships: [] },
    { ...base, clientId: "aunt2", firstName: "Тётя2", gender: "female", relationshipKind: "sibling", relativeClientId: "father", additionalRelationships: [] },
    { ...base, clientId: "child", firstName: "Сын", relationshipKind: "child", relativeClientId: "father", additionalRelationships: [
      { relationshipKind: "child", relativePersonId: "", relativeClientId: "mother" },
    ] },
  ];
  const response = await POST(request(people), context());
  assert.equal(response.status, 200);
  const { personIds: ids } = await response.json();
  assert.equal(state.committed.people.length, 5);
  assert.deepEqual(state.committed.edges, [
    { familyId: "unit-family", type: "spouse", fromPersonId: ids[0], toPersonId: ids[1] },
    { familyId: "unit-family", type: "sibling", fromPersonId: ids[2], toPersonId: ids[0] },
    { familyId: "unit-family", type: "sibling", fromPersonId: ids[3], toPersonId: ids[0] },
    { familyId: "unit-family", type: "parent", fromPersonId: ids[0], toPersonId: ids[4] },
    { familyId: "unit-family", type: "parent", fromPersonId: ids[1], toPersonId: ids[4] },
  ]);
  assert.equal(state.committed.audits.length, 5);
  assert.equal(state.committed.stats.length, 1);
});

test("invalid additional relationship on the final row aborts the entire batch before any write", async (t) => {
  const state = fakes(t);
  const response = await POST(request([entries[0], { ...entries[1], additionalRelationships: [
    { relationshipKind: "child", relativePersonId: "foreign-family-person" },
  ] }]), context());
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Человек 2:/);
  assert.deepEqual(state.attempts[0], noWrites());
  assert.deepEqual(state.committed, noWrites());
});

test("batch rejects foreign origins before auth and anonymous requests before body parsing", async (t) => {
  const state = fakes(t, { loggedIn: false });
  assert.equal((await POST(request(entries, "https://outside.invalid"), context())).status, 403);
  assert.equal(state.cookieRead.mock.callCount(), 0);
  const req = request();
  assert.equal((await POST(req, context())).status, 401);
  assert.equal(req.bodyUsed, false);
  assert.equal(state.sessionRead.mock.callCount(), 0);
  assert.equal(state.transaction.mock.callCount(), 0);
});

test("batch malformed JSON and invalid rows do not open a transaction", async (t) => {
  const state = fakes(t);
  for (const people of [null, [], Array(11).fill(entries[0]), [entries[0], { ...entries[1], firstName: "" }]]) {
    assert.equal((await POST(request(people), context())).status, 400);
  }
  const malformed = new Request(`${origin}/api/family/unit-family/people/batch`, { method: "POST", headers: { origin }, body: "{" });
  assert.equal((await POST(malformed, context())).status, 400);
  assert.equal(state.transaction.mock.callCount(), 0);
});

test("duplicate later rows fail validation before any write and preserve an actionable row number", async (t) => {
  const state = fakes(t);
  const response = await POST(request([entries[0], { ...entries[0], clientId: "other", relativeClientId: "parent" }]), context());
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Человек 2:.*уже есть/);
  assert.deepEqual(state.attempts[0], noWrites());
  assert.deepEqual(state.committed, noWrites());
});

for (const failAt of ["person", "edges", "audit", "stats"] as const) {
  test(`failure at ${failAt} rolls back the whole batch without retry or internal error exposure`, async (t) => {
    const state = fakes(t, { failAt });
    const response = await POST(request(), context());
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Не удалось сохранить людей. Попробуйте ещё раз." });
    assert.deepEqual(state.committed, noWrites());
    assert.equal(state.transaction.mock.callCount(), 1);
  });
}

for (const conflictCode of ["P2034", "P2002"]) {
  test(`batch retries only ${conflictCode}, rereads graph and commits once`, async (t) => {
    const state = fakes(t, { conflictCode, conflictCount: 2 });
    assert.equal((await POST(request(), context())).status, 200);
    assert.equal(state.reads.length, 3);
    assert.equal(state.committed.people.length, 2);
    assert.equal(state.committed.audits.length, 2);
  });
}

test("batch aborts after three conflicts and rereads concurrent changes", async (t) => {
  const state = fakes(t, { conflictCount: 3 });
  assert.equal((await POST(request(), context())).status, 409);
  assert.equal(state.transaction.mock.callCount(), 3);
  assert.deepEqual(state.committed, noWrites());
});

test("batch validation after conflict uses the fresh graph and does not duplicate a concurrent person", async (t) => {
  const state = fakes(t, { conflictCount: 1, concurrentParent: true });
  const response = await POST(request(), context());
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Человек 1:.*уже есть/);
  assert.equal(state.reads.length, 2);
  assert.deepEqual(state.attempts[1], noWrites());
  assert.deepEqual(state.committed, noWrites());
});

test("batch missing family returns 404 and no writes", async (t) => {
  const state = fakes(t, { missingFamily: true });
  assert.equal((await POST(request(), context())).status, 404);
  assert.deepEqual(state.committed, noWrites());
});

test("a committed batch replay is rejected as duplicate without writing a second copy", async (t) => {
  const state = fakes(t);
  assert.equal((await POST(request(), context())).status, 200);
  state.family.people.push(...state.committed.people);
  state.family.relationships.push(...state.committed.edges.map((edge) => ({
    type: edge.type as FamilyRelationship["type"], fromPersonId: String(edge.fromPersonId), toPersonId: String(edge.toPersonId),
  })));
  const response = await POST(request(), context());
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Человек 1:.*уже есть/);
  assert.deepEqual(state.attempts[1], noWrites());
  assert.equal(state.committed.people.length, 2);
  assert.equal(state.committed.audits.length, 2);
});

test("archived ancestors retain their parent slot during batch validation", async (t) => {
  const state = fakes(t);
  state.family.people.push(...["child", "father", "archived-parent"].map((id) => ({
    ...entries[0], id, firstName: id, isArchived: id === "archived-parent",
    photosCount: 0, audioCount: 0, documentsCount: 0,
  })));
  state.family.relationships.push(
    { type: "parent", fromPersonId: "father", toPersonId: "child" },
    { type: "parent", fromPersonId: "archived-parent", toPersonId: "child" },
  );
  for (const person of [
    { ...entries[0], relativePersonId: "child", relationshipKind: "parent" },
    { ...entries[0], relativePersonId: "father", relationshipKind: "spouse", sharedChildIds: ["child"] },
  ]) {
    const response = await POST(request([person]), context());
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Человек 1:/);
  }
  assert.ok(state.attempts.every((pending) => JSON.stringify(pending) === JSON.stringify(noWrites())));
  assert.deepEqual(state.committed, noWrites());
});

test("foreign or archived relatives and foreign shared children never receive batch edges", async (t) => {
  const state = fakes(t);
  state.family.people.push(
    { ...entries[0], id: "existing", firstName: "Существующий", isArchived: false },
    { ...entries[0], id: "archived", firstName: "Архивный", isArchived: true },
  );
  for (const person of [
    { ...entries[0], relativePersonId: "foreign" },
    { ...entries[0], relativePersonId: "archived" },
    { ...entries[0], relativePersonId: "existing", relationshipKind: "spouse", sharedChildIds: ["foreign-child"] },
  ]) assert.equal((await POST(request([person]), context())).status, 400);
  assert.deepEqual(state.committed, noWrites());
  assert.ok(state.attempts.every((pending) => pending.people.length === 0));
});

test("connection and other non-conflict Prisma errors are not retried or exposed", async (t) => {
  const state = fakes(t, { conflictCount: 3, conflictCode: "P1001" });
  const response = await POST(request(), context());
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Не удалось сохранить людей. Попробуйте ещё раз." });
  assert.equal(state.transaction.mock.callCount(), 1);
  assert.deepEqual(state.committed, noWrites());
});

const siblingSchemaError = () => new Prisma.PrismaClientUnknownRequestError(
  'Invalid prisma.relationship.createMany() invocation: ConnectorError(PostgresError { code: "22P02", message: "invalid input value for enum \\"RelationshipType\\": \\"sibling\\"" })',
  { clientVersion: "unit" },
);

for (const single of [false, true]) {
  test(`${single ? "single" : "batch"} missing sibling enum rolls back all writes, avoids retry and returns safe schema code`, async (t) => {
    const state = fakes(t, { single, failAt: "edges", failError: siblingSchemaError() });
    state.family.people.push({ ...entries[0], id: "father", isArchived: false, photosCount: 0, audioCount: 0, documentsCount: 0 });
    const person = { ...entries[0], firstName: "Сестра", gender: "female", relativePersonId: "father", relationshipKind: "sibling" };
    const req = single ? new Request(`${origin}/api/family/unit-family/people`, { method: "POST", headers: { origin }, body: JSON.stringify(person) }) : request([person]);
    const response = await (single ? singlePOST : POST)(req, context());
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, "SIBLING_SCHEMA_NOT_READY");
    assert.match(body.error, /брат \/ сестра.*обновление базы данных/);
    assert.doesNotMatch(JSON.stringify(body), /Prisma|22P02|RelationshipType|createMany|ConnectorError/);
    assert.equal(state.transaction.mock.callCount(), 1);
    assert.equal(state.attempts[0].people.length, 1);
    assert.deepEqual(state.committed, noWrites());
  });
}

test("single person route hides unknown failures and preserves domain validation and 404", async (t) => {
  const state = fakes(t, { single: true });
  state.family.people.push({ ...entries[0], id: "father", isArchived: false });
  const req = (person: unknown) => new Request(`${origin}/api/family/unit-family/people`, { method: "POST", headers: { origin }, body: JSON.stringify(person) });
  const response = await singlePOST(req({ ...entries[0], relativePersonId: "father" }), context());
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /уже есть/);
  assert.deepEqual(state.committed, noWrites());
  t.mock.method(prisma, "$transaction", async () => { throw new Error("private SQL query details"); });
  const failure = await singlePOST(req(entries[0]), context());
  assert.equal(failure.status, 500);
  assert.deepEqual(await failure.json(), { error: "Не удалось сохранить человека в базу." });
});

test("single missing family returns 404 and malformed JSON never writes", async (t) => {
  const state = fakes(t, { single: true, missingFamily: true });
  const req = new Request(`${origin}/api/family/unit-family/people`, { method: "POST", headers: { origin }, body: JSON.stringify(entries[0]) });
  assert.equal((await singlePOST(req, context())).status, 404);
  const malformed = new Request(req.url, { method: "POST", headers: { origin }, body: "{" });
  const response = await singlePOST(malformed, context());
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Некорректные данные человека." });
  assert.equal(state.transaction.mock.callCount(), 1);
  assert.deepEqual(state.committed, noWrites());
});
