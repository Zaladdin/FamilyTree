import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";

const previousDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = UNIT_DATABASE_URL;
const globalPrisma = globalThis as { prisma?: unknown };
const previousPrisma = globalPrisma.prisma;
const unexpected = async (..._args: unknown[]): Promise<unknown> => { throw new Error("Unexpected database access"); };
const prisma = { session: { findUnique: unexpected }, familyMembership: { findFirst: unexpected }, $transaction: unexpected };
globalPrisma.prisma = prisma;
after(() => {
  if (previousPrisma === undefined) delete globalPrisma.prisma;
  else globalPrisma.prisma = previousPrisma;
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});
const requireTest = createRequire(path.resolve("tests/family-relationship-mutation.test.ts"));
const headers: typeof import("next/headers") = requireTest("next/headers");
const { POST }: typeof import("../app/api/family/[slug]/people/[personId]/relationships/route") = requireTest("../app/api/family/[slug]/people/[personId]/relationships/route");
const { PATCH, DELETE }: typeof import("../app/api/family/[slug]/people/[personId]/relationships/[relationshipId]/route") = requireTest("../app/api/family/[slug]/people/[personId]/relationships/[relationshipId]/route");

type Edge = { id: string; fromPersonId: string; toPersonId: string; type: "parent" | "spouse" | "sibling"; origin: "manual" | "spouse" | "sibling"; sourcePersonId: string | null; version: number };
const edge = (id: string, fromPersonId: string, toPersonId: string, type: Edge["type"] = "parent", origin: Edge["origin"] = "manual"): Edge => ({ id, fromPersonId, toPersonId, type, origin, sourcePersonId: origin === "manual" ? null : "mom", version: 0 });
type Store = {
  id: string;
  people: { id: string; firstName: string; lastName: string; isArchived: boolean }[];
  relationships: Edge[];
  parentSuppressions: { fromPersonId: string; toPersonId: string }[];
  audits: Record<string, unknown>[];
};
function setup(t: TestContext, options: { edges?: Edge[]; txRole?: string | null; routeRole?: string | null; loggedIn?: boolean; auditFailure?: boolean; auditFailureAt?: number; conflictOnce?: boolean } = {}) {
  const state: Store = {
    id: "family", people: ["mom", "dad", "child", "sibling", "third"].map((id) => ({ id, firstName: id, lastName: "Тест", isArchived: false })),
    relationships: options.edges ?? [edge("parent", "mom", "child")], parentSuppressions: [], audits: [],
  };
  t.mock.method(headers, "cookies", async () => ({ get: () => options.loggedIn === false ? undefined : { value: "unit-cookie" } }));
  t.mock.method(prisma.session, "findUnique", async () => ({ expiresAt: new Date(Date.now() + 60_000), user: { id: "actor", firstName: "Тест", lastName: "Редактор" } }));
  t.mock.method(prisma.familyMembership, "findFirst", async () => options.routeRole === null ? null : { role: options.routeRole ?? "editor" });
  let attempts = 0;
  let permissionsRead = 0;
  let nextId = 1;
  const transaction = t.mock.method(prisma, "$transaction", async (operation: (tx: unknown) => Promise<unknown>, settings: unknown) => {
    assert.deepEqual(settings, { isolationLevel: "Serializable" });
    attempts += 1;
    const pending = structuredClone(state);
    const result = await operation({
      family: { findUnique: async ({ where }: { where: { slug: string } }) => where.slug === "unit" ? structuredClone(pending) : null },
      familyMembership: { findFirst: async ({ where }: { where: { familyId: string; userId: string } }) => {
        permissionsRead += 1;
        assert.deepEqual(where, { familyId: "family", userId: "actor" });
        return options.txRole === null ? null : { role: options.txRole ?? "editor" };
      } },
      relationship: {
        create: async ({ data }: { data: Omit<Edge, "id" | "version"> & { version?: number } }) => {
          const saved = { version: 0, ...data, id: `new-${nextId++}` } as Edge;
          pending.relationships.push(saved); return saved;
        },
        updateMany: async ({ where, data }: { where: { id: string; familyId: string; version: number }; data: Partial<Omit<Edge, "version">> & { version?: { increment: number } } }) => {
          const index = pending.relationships.findIndex((item) => item.id === where.id && item.version === where.version);
          if (where.familyId !== pending.id || index === -1) return { count: 0 };
          const old = pending.relationships[index];
          pending.relationships[index] = { ...old, ...data, version: old.version + (data.version?.increment ?? 0) } as Edge;
          return { count: 1 };
        },
        deleteMany: async ({ where }: { where: { id: string; familyId: string; version: number } }) => {
          const oldCount = pending.relationships.length;
          pending.relationships = pending.relationships.filter((item) => !(item.id === where.id && item.version === where.version && where.familyId === pending.id));
          return { count: oldCount - pending.relationships.length };
        },
      },
      parentSuppression: {
        upsert: async ({ create }: { create: { familyId: string; fromPersonId: string; toPersonId: string } }) => {
          if (!pending.parentSuppressions.some((item) => item.fromPersonId === create.fromPersonId && item.toPersonId === create.toPersonId)) pending.parentSuppressions.push(create);
          return create;
        },
        deleteMany: async ({ where }: { where: { familyId: string; fromPersonId: string; toPersonId: string } }) => {
          pending.parentSuppressions = pending.parentSuppressions.filter((item) => !(where.familyId === pending.id && item.fromPersonId === where.fromPersonId && item.toPersonId === where.toPersonId));
          return { count: 1 };
        },
      },
      auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => {
        if (options.auditFailure || pending.audits.length + 1 === options.auditFailureAt) throw new Error("Private storage failure");
        pending.audits.push(data); return data;
      } },
    });
    if (options.conflictOnce && attempts === 1) throw new Prisma.PrismaClientKnownRequestError("Unit conflict", { code: "P2034", clientVersion: "unit" });
    Object.assign(state, pending);
    return result;
  });
  return { state, transaction, permissionsRead: () => permissionsRead };
}
const origin = "http://127.0.0.1:3000";
function request(method: string, body: unknown, foreign = false) {
  return new Request(`${origin}/api/family/unit/people/mom/relationships/parent`, {
    method, headers: { origin: foreign ? "https://outside.invalid" : origin, "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
const context = (personId = "mom", relationshipId = "parent", slug = "unit") => ({ params: Promise.resolve({ slug, personId, relationshipId }) });
const parentInput = { relativePersonId: "child", relationshipKind: "parent" };

test("spouse POST records inferred parent metadata and audits every actual edge", async (t) => {
  const { state } = setup(t);
  const response = await POST(request("POST", { relativePersonId: "dad", relationshipKind: "spouse" }), context());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).warnings, []);
  assert.equal(state.relationships.length, 3);
  const inferred = state.relationships.find((item) => item.fromPersonId === "dad" && item.toPersonId === "child");
  assert.equal(inferred?.origin, "spouse");
  assert.equal(inferred?.sourcePersonId, "mom");
  assert.equal(state.audits.length, 2);
  assert.match(String(state.audits[1].message), /автоматически|супружеств/i);
});

test("deleting any parent saves an exception which spouse replay cannot recreate", async (t) => {
  const { state } = setup(t, { edges: [edge("parent", "dad", "child", "parent", "spouse"), edge("mom-parent", "mom", "child"), edge("marriage", "dad", "mom", "spouse")] });
  assert.equal((await DELETE(request("DELETE", { expectedVersion: 0 }), context("dad"))).status, 200);
  assert.equal(state.parentSuppressions.length, 1);
  assert.equal((await POST(request("POST", { relativePersonId: "dad", relationshipKind: "spouse" }), context())).status, 200);
  assert.equal(state.relationships.some((item) => item.fromPersonId === "dad" && item.toPersonId === "child"), false);
  assert.equal(state.audits.length, 1);
  assert.equal((await DELETE(request("DELETE", { expectedVersion: 0 }), context("dad"))).status, 404);
});

test("explicit parent creation clears a saved exception and promotion increments version", async (t) => {
  const { state } = setup(t, { edges: [] });
  state.parentSuppressions.push({ fromPersonId: "mom", toPersonId: "child" });
  assert.equal((await POST(request("POST", parentInput), context())).status, 200);
  assert.deepEqual(state.parentSuppressions, []);
  assert.equal(state.relationships[0].origin, "manual");
  state.relationships[0].origin = "spouse";
  assert.equal((await POST(request("POST", parentInput), context())).status, 200);
  assert.equal(state.relationships[0].origin, "manual");
  assert.equal(state.relationships[0].version, 1);
  assert.equal(state.audits.length, 2);
});

test("PATCH keeps identity, increments version, validates with old edge removed and suppresses old parent", async (t) => {
  const { state } = setup(t);
  const response = await PATCH(request("PATCH", { expectedVersion: 0, relativePersonId: "dad", relationshipKind: "spouse" }), context());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).version, 1);
  assert.equal(state.relationships[0].id, "parent");
  assert.equal(state.relationships[0].type, "spouse");
  assert.deepEqual(state.parentSuppressions.map(({ fromPersonId, toPersonId }) => ({ fromPersonId, toPersonId })), [{ fromPersonId: "mom", toPersonId: "child" }]);
  assert.equal(state.audits.length, 1);
  assert.equal((await PATCH(request("PATCH", { expectedVersion: 0, ...parentInput }), context())).status, 409);
  assert.equal(state.relationships[0].version, 1);
});

test("PATCH allows reversing a parent edge without reporting its removed edge as a cycle", async (t) => {
  const { state } = setup(t);
  assert.equal((await PATCH(request("PATCH", { expectedVersion: 0, relativePersonId: "child", relationshipKind: "child" }), context())).status, 200);
  assert.equal(state.relationships[0].fromPersonId, "child");
  assert.equal(state.relationships[0].toPersonId, "mom");
});

test("editing spouse leaves prior automatic parents intact and never cascades removals", async (t) => {
  const { state } = setup(t, { edges: [edge("parent", "mom", "dad", "spouse"), edge("auto", "dad", "child", "parent", "spouse")] });
  assert.equal((await DELETE(request("DELETE", { expectedVersion: 0 }), context())).status, 200);
  assert.equal(state.relationships.length, 1);
  assert.equal(state.relationships[0].id, "auto");
  assert.equal(state.parentSuppressions.length, 0);
});

test("PATCH duplicate target and invalid graph roll back all edge, suppression and audit mutations", async (t) => {
  const { state } = setup(t, { edges: [edge("parent", "mom", "child"), edge("other", "mom", "dad", "spouse")] });
  const before = structuredClone(state);
  assert.equal((await PATCH(request("PATCH", { expectedVersion: 0, relativePersonId: "dad", relationshipKind: "spouse" }), context())).status, 409);
  assert.deepEqual(state, before);
  assert.equal((await PATCH(request("PATCH", { expectedVersion: 0, relativePersonId: "mom", relationshipKind: "parent" }), context())).status, 400);
  assert.deepEqual(state, before);
});

for (const [name, handler] of [["PATCH", PATCH], ["DELETE", DELETE]] as const) {
  test(`${name} requires a nonnegative integer version and refuses foreign relationships`, async (t) => {
    const { transaction } = setup(t);
    for (const version of [undefined, -1, 0.5, "0", null]) {
      assert.equal((await handler(request(name, { ...parentInput, expectedVersion: version }), context())).status, 400);
    }
    assert.equal(transaction.mock.callCount(), 0);
    assert.equal((await handler(request(name, { ...parentInput, expectedVersion: 0 }), context("dad"))).status, 404);
    assert.equal((await handler(request(name, { ...parentInput, expectedVersion: 0 }), context("mom", "foreign"))).status, 404);
    assert.equal((await handler(request(name, { ...parentInput, expectedVersion: 0 }), context("mom", "parent", "foreign"))).status, 404);
  });
  test(`${name} rejects changed membership inside the transaction`, async (t) => {
    const { state } = setup(t, { txRole: "member" });
    const response = await handler(request(name, { ...parentInput, expectedVersion: 0 }), context());
    assert.equal(response.status, 403);
    assert.equal(state.relationships.length, 1);
    assert.equal(state.audits.length, 0);
  });
  test(`${name} rejects unauthenticated and foreign-origin requests before mutation`, async (t) => {
    const { transaction } = setup(t, { loggedIn: false });
    assert.equal((await handler(request(name, { ...parentInput, expectedVersion: 0 }, true), context())).status, 403);
    assert.equal((await handler(request(name, { ...parentInput, expectedVersion: 0 }), context())).status, 401);
    assert.equal(transaction.mock.callCount(), 0);
  });
  test(`${name} rejects a read-only member before body parsing and a stale version before mutation`, async (t) => {
    const options = { routeRole: "member" };
    const { state, transaction } = setup(t, options);
    const req = request(name, { ...parentInput, expectedVersion: 0 });
    assert.equal((await handler(req, context())).status, 403);
    assert.equal(req.bodyUsed, false);
    assert.equal(transaction.mock.callCount(), 0);
    options.routeRole = "editor";
    assert.equal((await handler(request(name, { ...parentInput, expectedVersion: 1 }), context())).status, 409);
    assert.equal(state.relationships[0].version, 0);
    assert.deepEqual(state.parentSuppressions, []);
    assert.deepEqual(state.audits, []);
  });
  test(`${name} rolls back atomically when the audit fails`, async (t) => {
    const { state } = setup(t, { auditFailure: true });
    const before = structuredClone(state);
    const response = await handler(request(name, { relativePersonId: "dad", relationshipKind: "spouse", expectedVersion: 0 }), context());
    assert.equal(response.status, 500);
    assert.doesNotMatch(JSON.stringify(await response.json()), /Private storage/);
    assert.deepEqual(state, before);
  });
}

test("POST retries the full graph transaction and rechecks permission without duplicate audit", async (t) => {
  const { state, permissionsRead } = setup(t, { edges: [], conflictOnce: true });
  assert.equal((await POST(request("POST", parentInput), context())).status, 200);
  assert.equal(permissionsRead(), 2);
  assert.equal(state.relationships.length, 1);
  assert.equal(state.audits.length, 1);
});

test("spouse POST retains manual parents and returns readable inference conflicts", async (t) => {
  const { state } = setup(t, { edges: [edge("one", "mom", "child"), edge("two", "dad", "child")] });
  const response = await POST(request("POST", { relativePersonId: "third", relationshipKind: "spouse" }), context());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.warnings.length, 1);
  assert.match(body.warnings[0], /third Тест.*child Тест.*два родителя/);
  assert.equal(state.relationships.length, 3);
  assert.equal(state.relationships.filter((item) => item.type === "parent").length, 2);
  assert.equal(state.audits.length, 1);
});

test("sibling POST stores shared parent provenance and replay remains idempotent", async (t) => {
  const { state } = setup(t);
  const input = { relativePersonId: "sibling", relationshipKind: "sibling" };
  assert.equal((await POST(request("POST", input), context("child"))).status, 200);
  const shared = state.relationships.find((item) => item.type === "parent" && item.toPersonId === "sibling");
  assert.equal(shared?.fromPersonId, "mom");
  assert.equal(shared?.origin, "sibling");
  assert.equal(shared?.sourcePersonId, "child");
  assert.equal((await POST(request("POST", { relativePersonId: "child", relationshipKind: "sibling" }), context("sibling"))).status, 200);
  assert.equal(state.relationships.length, 3);
  assert.equal(state.audits.length, 2);
});

test("failure while auditing an inferred edge rolls back the explicit edge too", async (t) => {
  const { state } = setup(t, { auditFailureAt: 2 });
  const before = structuredClone(state);
  const response = await POST(request("POST", { relativePersonId: "dad", relationshipKind: "spouse" }), context());
  assert.equal(response.status, 500);
  assert.deepEqual(state, before);
  assert.doesNotMatch(JSON.stringify(await response.json()), /Private storage/);
});

test("POST rechecks revoked editor rights and never changes the graph", async (t) => {
  const { state } = setup(t, { txRole: null });
  assert.equal((await POST(request("POST", { relativePersonId: "dad", relationshipKind: "spouse" }), context())).status, 403);
  assert.equal(state.relationships.length, 1);
  assert.deepEqual(state.audits, []);
});
