import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { Prisma } from "@prisma/client";
import type { FamilyRelationship, FamilyRole } from "@/lib/types";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";

// Install a closed, plain-object Prisma singleton before importing any app code.
// No PrismaClient is constructed; these tests never access application data.
const previousDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = UNIT_DATABASE_URL;
const globalForPrisma = globalThis as { prisma?: unknown };
const previousPrisma = globalForPrisma.prisma;
const unexpected = async (..._args: unknown[]): Promise<unknown> => { throw new Error("Unexpected database call in relationship unit test"); };
const prisma = {
  session: { findUnique: unexpected },
  familyMembership: { findFirst: unexpected },
  $transaction: unexpected,
};
globalForPrisma.prisma = prisma;
after(() => {
  if (previousPrisma === undefined) delete globalForPrisma.prisma;
  else globalForPrisma.prisma = previousPrisma;
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});
const requireFromTest = createRequire(path.resolve("tests/family-relationship-route.test.ts"));
const nextHeaders: typeof import("next/headers") = requireFromTest("next/headers");
assert.equal(requireFromTest("../lib/prisma").prisma, prisma);
const { POST }: typeof import("../app/api/family/[slug]/people/[personId]/relationships/route") = requireFromTest("../app/api/family/[slug]/people/[personId]/relationships/route");

type FakeFamily = {
  id: string;
  people: { id: string; isArchived: boolean; firstName: string; lastName: string }[];
  relationships: FamilyRelationship[];
};
function sampleFamily(): FakeFamily {
  return {
    id: "unit-family-id",
    people: [
      { id: "mom", isArchived: false, firstName: "Мама", lastName: "Тестовая" },
      { id: "child", isArchived: false, firstName: "Ребёнок", lastName: "Тестовый" },
      { id: "dad", isArchived: false, firstName: "Папа", lastName: "Тестовый" },
    ],
    relationships: [{ fromPersonId: "dad", toPersonId: "child", type: "parent" }],
  };
}
function fakes(t: TestContext, options: { role?: FamilyRole | null; loggedIn?: boolean; family?: FakeFamily | null; conflictCount?: number; conflictCode?: string; auditFails?: boolean; relationshipError?: Error } = {}) {
  const family = options.family === undefined ? sampleFamily() : options.family;
  const cookieRead = t.mock.method(nextHeaders, "cookies", async () => ({ get: () => options.loggedIn === false ? undefined : { value: "unit-only-cookie" } }));
  const sessionRead = t.mock.method(prisma.session, "findUnique", async () => ({
    expiresAt: new Date(Date.now() + 60_000),
    user: { id: "unit-actor", firstName: "Редактор", lastName: "Тестовый", email: "unit@example.invalid" },
  }));
  const roleRead = t.mock.method(prisma.familyMembership, "findFirst", async () => options.role === null ? null : { role: options.role ?? "editor" });
  const relationWrites: unknown[] = [];
  const auditWrites: unknown[] = [];
  const familyReads: unknown[] = [];
  let attempts = 0;
  const transaction = t.mock.method(prisma, "$transaction", async (callback: (tx: unknown) => Promise<unknown>, settings: unknown) => {
    attempts += 1;
    assert.deepEqual(settings, { isolationLevel: "Serializable" });
    if (attempts <= (options.conflictCount ?? 0)) {
      throw new Prisma.PrismaClientKnownRequestError("Simulated transaction conflict", { code: options.conflictCode ?? "P2034", clientVersion: "unit" });
    }
    const stagedRelations: unknown[] = [];
    const stagedAudits: unknown[] = [];
    const result = await callback({
      family: { findUnique: async (query: unknown) => {
        familyReads.push(query);
        return family && { ...family, parentSuppressions: [], relationships: family.relationships.map((item, index) => ({ id: `edge-${index}`, origin: "manual", sourcePersonId: null, version: 0, ...item })) };
      } },
      familyMembership: { findFirst: async () => ({ role: options.role ?? "editor" }) },
      parentSuppression: { deleteMany: async () => ({ count: 0 }) },
      relationship: { create: async (query: { data: Record<string, unknown> }) => {
        if (options.relationshipError) throw options.relationshipError;
        stagedRelations.push(query); return { id: `new-${stagedRelations.length}`, version: 0, ...query.data };
      } },
      auditLog: { create: async (query: unknown) => {
        if (options.auditFails) throw new Error("Internal unit-only storage detail must not be returned");
        stagedAudits.push(query); return query;
      } },
    });
    // A failed callback cannot commit either write.
    relationWrites.push(...stagedRelations);
    auditWrites.push(...stagedAudits);
    return result;
  });
  return { family, cookieRead, sessionRead, roleRead, transaction, relationWrites, auditWrites, familyReads };
}
const origin = "http://127.0.0.1:3000";
function request(payload: unknown = { relativePersonId: "child", relationshipKind: "parent" }, requestOrigin = origin) {
  return new Request(`${origin}/api/family/unit-family/people/mom/relationships`, {
    method: "POST", headers: { origin: requestOrigin, host: "127.0.0.1:3000", "content-type": "application/json" }, body: JSON.stringify(payload),
  });
}
const context = (personId = "mom") => ({ params: Promise.resolve({ slug: "unit-family", personId }) });

for (const role of ["owner", "admin", "editor"] as const) {
  test(`relationship POST permits ${role}, saves one explicit edge and its actor audit atomically`, async (t) => {
    const state = fakes(t, { role });
    const response = await POST(request(), context());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).personId, "mom");
    assert.deepEqual(state.roleRead.mock.calls[0].arguments[0], { where: { family: { slug: "unit-family" }, userId: "unit-actor" }, select: { role: true } });
    assert.equal(state.familyReads.length, 1);
    assert.deepEqual((state.familyReads[0] as { where: unknown }).where, { slug: "unit-family" });
    assert.deepEqual(state.relationWrites, [{ data: { familyId: "unit-family-id", fromPersonId: "mom", toPersonId: "child", type: "parent", origin: "manual", sourcePersonId: null } }]);
    assert.equal(state.auditWrites.length, 1);
    const audit = (state.auditWrites[0] as { data: Record<string, unknown> }).data;
    assert.equal(audit.familyId, "unit-family-id");
    assert.equal(audit.personId, "mom");
    assert.equal(audit.actorName, "Редактор Тестовый");
    assert.equal(audit.action, "person_updated");
    assert.match(String(audit.message), /Мама Тестовая.*родитель.*Ребёнок Тестовый/);
  });
}

for (const role of ["member", "guest", null] as const) {
  test(`relationship POST denies ${role ?? "nonmember"} before body parsing and mutation`, async (t) => {
    const state = fakes(t, { role });
    const req = request();
    assert.equal((await POST(req, context())).status, 403);
    assert.equal(req.bodyUsed, false);
    assert.equal(state.transaction.mock.callCount(), 0);
  });
}

test("relationship POST requires login and rejects foreign origins before touching auth", async (t) => {
  const state = fakes(t, { loggedIn: false });
  const foreign = request(undefined, "https://outside.example");
  assert.equal((await POST(foreign, context())).status, 403);
  assert.equal(foreign.bodyUsed, false);
  assert.equal(state.cookieRead.mock.callCount(), 0);
  assert.equal((await POST(request(), context())).status, 401);
  assert.equal(state.sessionRead.mock.callCount(), 0);
  assert.equal(state.transaction.mock.callCount(), 0);
});

test("invalid relationship payloads and malformed JSON never begin a write transaction", async (t) => {
  const state = fakes(t);
  for (const payload of [null, [], {}, { relativePersonId: "child", relationshipKind: "unknown" }]) {
    assert.equal((await POST(request(payload), context())).status, 400);
  }
  const malformed = new Request(`${origin}/api/family/unit-family/people/mom/relationships`, { method: "POST", headers: { origin }, body: "{" });
  assert.equal((await POST(malformed, context())).status, 400);
  assert.equal(state.transaction.mock.callCount(), 0);
});

test("missing, foreign and archived people never write relationships", async (t) => {
  const state = fakes(t);
  assert.equal((await POST(request(), context("other-family-person"))).status, 404);
  assert.equal((await POST(request({ relativePersonId: "other-family-person", relationshipKind: "parent" }), context())).status, 404);
  state.family!.people[0].isArchived = true;
  assert.equal((await POST(request(), context())).status, 404);
  assert.deepEqual(state.relationWrites, []);
  assert.deepEqual(state.auditWrites, []);
});

test("missing family returns not found without mutation", async (t) => {
  const state = fakes(t, { family: null });
  assert.equal((await POST(request(), context())).status, 404);
  assert.deepEqual(state.relationWrites, []);
});

test("duplicate parent and inverse spouse requests succeed without extra relationship or audit", async (t) => {
  const family = sampleFamily();
  family.relationships.push({ fromPersonId: "mom", toPersonId: "child", type: "parent" }, { fromPersonId: "dad", toPersonId: "mom", type: "spouse" });
  const state = fakes(t, { family });
  assert.equal((await POST(request(), context())).status, 200);
  assert.equal((await POST(request({ relativePersonId: "dad", relationshipKind: "spouse" }), context())).status, 200);
  assert.deepEqual(state.relationWrites, []);
  assert.deepEqual(state.auditWrites, []);
});

test("direct sibling route works without known parents and inverse replay creates no duplicate or extra audit", async (t) => {
  const state = fakes(t);
  const response = await POST(request({ relativePersonId: "dad", relationshipKind: "sibling" }), context());
  assert.equal(response.status, 200);
  assert.match((await response.json()).message, /брат\/сестра/);
  const edge: FamilyRelationship = { type: "sibling", fromPersonId: "mom", toPersonId: "dad" };
  assert.deepEqual(state.relationWrites, [{ data: { familyId: "unit-family-id", ...edge, origin: "manual", sourcePersonId: null } }]);
  assert.equal(state.auditWrites.length, 1);
  assert.match(String((state.auditWrites[0] as { data: { message: string } }).data.message), /брат\/сестра/);
  state.family!.relationships.push(edge);
  const replay = await POST(request({ relativePersonId: "mom", relationshipKind: "sibling" }), context("dad"));
  assert.equal(replay.status, 200);
  assert.equal(state.relationWrites.length, 1);
  assert.equal(state.auditWrites.length, 1);
});

for (const conflictCode of ["P2034", "P2002"]) {
  test(`relationship transaction retries ${conflictCode} then commits one edge and audit`, async (t) => {
    const state = fakes(t, { conflictCount: 2, conflictCode });
    assert.equal((await POST(request(), context())).status, 200);
    assert.equal(state.transaction.mock.callCount(), 3);
    assert.equal(state.relationWrites.length, 1);
    assert.equal(state.auditWrites.length, 1);
  });
}

test("exhausted conflicts return retryable 409 and do not commit", async (t) => {
  const state = fakes(t, { conflictCount: 3 });
  assert.equal((await POST(request(), context())).status, 409);
  assert.equal(state.transaction.mock.callCount(), 3);
  assert.deepEqual(state.relationWrites, []);
  assert.deepEqual(state.auditWrites, []);
});

test("audit failure rolls back the relationship and does not expose storage details", async (t) => {
  const state = fakes(t, { auditFails: true });
  const response = await POST(request(), context());
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Не удалось сохранить родственную связь." });
  assert.deepEqual(state.relationWrites, []);
  assert.deepEqual(state.auditWrites, []);
  assert.equal(state.transaction.mock.callCount(), 1);
});

test("missing sibling enum preserves both people and returns safe 503 without retry or audit", async (t) => {
  const relationshipError = new Prisma.PrismaClientUnknownRequestError(
    'ConnectorError(PostgresError { code: "22P02", message: "invalid input value for enum \\"RelationshipType\\": \\"sibling\\"" })',
    { clientVersion: "unit" },
  );
  const state = fakes(t, { relationshipError });
  const response = await POST(request({ relativePersonId: "dad", relationshipKind: "sibling" }), context());
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "SIBLING_SCHEMA_NOT_READY");
  assert.doesNotMatch(JSON.stringify(body), /Prisma|22P02|RelationshipType|ConnectorError/);
  assert.equal(state.transaction.mock.callCount(), 1);
  assert.deepEqual(state.relationWrites, []);
  assert.deepEqual(state.auditWrites, []);
  assert.equal(state.family!.people.length, 3);
});
