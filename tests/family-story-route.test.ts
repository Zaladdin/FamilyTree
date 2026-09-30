import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";

const previousUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = UNIT_DATABASE_URL;
const globalPrisma = globalThis as { prisma?: unknown };
const previousPrisma = globalPrisma.prisma;
const unexpected = async (..._args: unknown[]): Promise<unknown> => { throw new Error("Unexpected database access"); };
const prisma = { session: { findUnique: unexpected }, familyMembership: { findFirst: unexpected }, $transaction: unexpected };
globalPrisma.prisma = prisma;
after(() => {
  if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  if (previousPrisma === undefined) delete globalPrisma.prisma; else globalPrisma.prisma = previousPrisma;
});
const requireTest = createRequire(path.resolve("tests/family-story-route.test.ts"));
const headers: typeof import("next/headers") = requireTest("next/headers");
const { POST }: typeof import("../app/api/family/[slug]/people/[personId]/stories/route") = requireTest("../app/api/family/[slug]/people/[personId]/stories/route");
const { PATCH, DELETE }: typeof import("../app/api/family/[slug]/people/[personId]/stories/[storyId]/route") = requireTest("../app/api/family/[slug]/people/[personId]/stories/[storyId]/route");
const { POST: RESTORE }: typeof import("../app/api/family/[slug]/people/[personId]/stories/[storyId]/restore/route") = requireTest("../app/api/family/[slug]/people/[personId]/stories/[storyId]/restore/route");
const repository: typeof import("../lib/family-story-repository") = requireTest("../lib/family-story-repository");

type StoryRow = { id: string; personId: string; title: string; body: string; narrator: string | null; version: number; deletedAt: Date | null; createdAt: Date; updatedAt: Date };
const existing = (): StoryRow => ({ id: "story", personId: "person", title: "Первая история", body: "Приватный исходный текст", narrator: "Рассказчик", version: 0, deletedAt: null, createdAt: new Date(0), updatedAt: new Date(0) });
const base = { title: "  Новая история  ", body: "Первый абзац.\r\n\r\nВторой абзац.", narrator: "  Рассказчик  " };
const actor = { slug: "family", personId: "person", actorName: "Тест Редактор", actorUserId: "actor" };
function setup(t: TestContext, options: {
  loggedIn?: boolean; routeRole?: string | null; txRole?: (attempt: number) => string | null;
  archived?: boolean; missingFamily?: boolean; stories?: StoryRow[]; auditFails?: boolean;
  conflictCount?: number; casMiss?: boolean; writeError?: Error;
} = {}) {
  const state = { stories: options.stories ?? [existing()], audits: [] as Record<string, unknown>[], storiesCount: 1 };
  t.mock.method(headers, "cookies", async () => ({ get: () => options.loggedIn === false ? undefined : { value: "unit-cookie" } }));
  t.mock.method(prisma.session, "findUnique", async () => ({ expiresAt: new Date(Date.now() + 60_000), user: { id: "actor", firstName: "Тест", lastName: "Редактор" } }));
  t.mock.method(prisma.familyMembership, "findFirst", async () => options.routeRole === null ? null : { role: options.routeRole ?? "editor" });
  let attempts = 0;
  let permissionReads = 0;
  const transaction = t.mock.method(prisma, "$transaction", async (run: (tx: unknown) => Promise<unknown>, settings: unknown) => {
    assert.deepEqual(settings, { isolationLevel: "Serializable" });
    attempts += 1;
    const pending = structuredClone(state);
    const result = await run({
      family: {
        findUnique: async ({ where }: { where: { slug: string } }) => where.slug === "family" && !options.missingFamily ? { id: "family-id" } : null,
        update: async ({ where, data }: { where: { id: string }; data: { storiesCount: number } }) => {
          assert.deepEqual(where, { id: "family-id" }); pending.storiesCount = data.storiesCount; return data;
        },
      },
      familyMembership: { findFirst: async ({ where }: { where: unknown }) => {
        permissionReads += 1;
        assert.deepEqual(where, { familyId: "family-id", userId: "actor" });
        const role = options.txRole ? options.txRole(attempts) : "editor";
        return role ? { role } : null;
      } },
      person: { findFirst: async ({ where }: { where: { id: string; familyId: string; isArchived: boolean } }) => {
        assert.equal(where.familyId, "family-id"); assert.equal(where.isArchived, false);
        return where.id === "person" && !options.archived ? { id: "person", firstName: "Имя", middleName: "", lastName: "Фамилия" } : null;
      } },
      story: {
        findFirst: async ({ where }: { where: { id: string; personId: string } }) => structuredClone(pending.stories.find((item) => item.id === where.id && item.personId === where.personId) ?? null),
        create: async ({ data }: { data: Omit<StoryRow, "id" | "createdAt" | "updatedAt" | "version" | "deletedAt"> }) => {
          if (options.writeError) throw options.writeError;
          const story = { ...existing(), ...data, id: "new-story", version: 0, deletedAt: null };
          pending.stories.push(story); return story;
        },
        updateMany: async ({ where, data }: {
          where: { id: string; personId: string; version: number; deletedAt: null | { not: null } };
          data: Partial<Omit<StoryRow, "version">> & { version: { increment: number } };
        }) => {
          if (options.writeError) throw options.writeError;
          if (options.casMiss) return { count: 0 };
          const row = pending.stories.find((item) => item.id === where.id && item.personId === where.personId && item.version === where.version &&
            (where.deletedAt === null ? item.deletedAt === null : item.deletedAt !== null));
          if (!row) return { count: 0 };
          Object.assign(row, data, { version: row.version + data.version.increment }); return { count: 1 };
        },
        count: async ({ where }: { where: unknown }) => {
          assert.deepEqual(where, { deletedAt: null, person: { familyId: "family-id", isArchived: false } });
          return pending.stories.filter((story) => story.personId === "person" && story.deletedAt === null).length;
        },
      },
      auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => {
        if (options.auditFails) throw new Error("Private SQL infrastructure text");
        pending.audits.push(data); return data;
      } },
    });
    if (attempts <= (options.conflictCount ?? 0)) throw new Prisma.PrismaClientKnownRequestError("Unit conflict", { code: "P2034", clientVersion: "unit" });
    Object.assign(state, pending); return result;
  });
  return { state, transaction, permissionReads: () => permissionReads };
}
const origin = "http://localhost:3000";
const context = (personId = "person", storyId = "story", slug = "family") => ({ params: Promise.resolve({ slug, personId, storyId }) });
const request = (method: string, payload: unknown, foreign = false) => new Request(`${origin}/api/family/family/people/person/stories/story`, {
  method, headers: { origin: foreign ? "https://foreign.invalid" : origin, "content-type": "application/json" }, body: JSON.stringify(payload),
});

test("story creation preserves paragraph breaks and atomically stores version, counter and body-free audit", async (t) => {
  const { state } = setup(t, { stories: [] });
  const response = await POST(request("POST", base), context());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.personId, "person"); assert.equal(body.version, 0); assert.equal(body.storyId, "new-story");
  assert.equal(state.stories[0].title, "Новая история");
  assert.equal(state.stories[0].body, "Первый абзац.\n\nВторой абзац.");
  assert.equal(state.storiesCount, 1);
  assert.equal(state.audits[0].action, "story_added");
  assert.doesNotMatch(JSON.stringify(state.audits), /Первый абзац|Второй абзац/);
});

test("story PATCH updates one version, preserves creation date and returns a safe summary", async (t) => {
  const { state } = setup(t);
  const response = await PATCH(request("PATCH", { ...base, expectedVersion: 0 }), context());
  assert.equal(response.status, 200); assert.equal((await response.json()).version, 1);
  assert.equal(state.stories[0].version, 1); assert.equal(state.stories[0].createdAt.getTime(), 0);
  assert.equal(state.stories[0].body, "Первый абзац.\n\nВторой абзац.");
  assert.equal(state.audits[0].action, "story_updated");
  assert.equal((await PATCH(request("PATCH", { ...base, expectedVersion: 0 }), context())).status, 409);
  assert.equal(state.audits.length, 1);
});

test("delete and restore keep text, increment version and recalculate only active undeleted stories", async (t) => {
  const { state } = setup(t, { stories: [existing(), { ...existing(), id: "archived-story", personId: "archived-person" }] });
  assert.equal((await DELETE(request("DELETE", { expectedVersion: 0 }), context())).status, 200);
  assert.ok(state.stories[0].deletedAt instanceof Date); assert.equal(state.stories[0].version, 1); assert.equal(state.storiesCount, 0);
  assert.equal(state.stories[0].body, "Приватный исходный текст");
  assert.equal((await DELETE(request("DELETE", { expectedVersion: 1 }), context())).status, 409);
  assert.equal((await PATCH(request("PATCH", { ...base, expectedVersion: 1 }), context())).status, 409);
  assert.equal((await RESTORE(request("POST", { expectedVersion: 0 }), context())).status, 409);
  assert.equal((await RESTORE(request("POST", { expectedVersion: 1 }), context())).status, 200);
  assert.equal(state.stories[0].deletedAt, null); assert.equal(state.stories[0].version, 2); assert.equal(state.storiesCount, 1);
  assert.equal((await RESTORE(request("POST", { expectedVersion: 2 }), context())).status, 409);
  assert.deepEqual(state.audits.map((item) => item.action), ["story_deleted", "story_restored"]);
});

for (const [method, handler, payload] of [["POST", POST, base], ["PATCH", PATCH, { ...base, expectedVersion: 0 }], ["DELETE", DELETE, { expectedVersion: 0 }], ["POST", RESTORE, { expectedVersion: 0 }]] as const) {
  const label = handler === RESTORE ? "restore" : method;
  test(`story ${label} rejects foreign origins and anonymous callers before a transaction`, async (t) => {
    const { transaction } = setup(t, { loggedIn: false });
    assert.equal((await handler(request(method, payload, true), context())).status, 403);
    assert.equal((await handler(request(method, payload), context())).status, 401);
    assert.equal(transaction.mock.callCount(), 0);
  });
  test(`story ${label} rejects read-only access before parsing`, async (t) => {
    const { transaction } = setup(t, { routeRole: "member" });
    const req = request(method, payload);
    assert.equal((await handler(req, context())).status, 403); assert.equal(req.bodyUsed, false);
    assert.equal(transaction.mock.callCount(), 0);
  });
  test(`story ${label} rechecks transaction permissions and scopes the active person`, async (t) => {
    const options = { txRole: () => "member", archived: false };
    const { state } = setup(t, options);
    assert.equal((await handler(request(method, payload), context())).status, 403);
    options.txRole = () => "editor";
    assert.equal((await handler(request(method, payload), context("foreign-person"))).status, 404);
    assert.equal((await handler(request(method, payload), context("person", "story", "foreign-family"))).status, 404);
    options.archived = true;
    assert.equal((await handler(request(method, payload), context())).status, 404);
    assert.deepEqual(state.audits, []);
  });
  test(`story ${label} rolls back content, version, counter and audit on audit failure`, async (t) => {
    const row = existing(); if (handler === RESTORE) row.deletedAt = new Date(1);
    const { state, transaction } = setup(t, { stories: [row], auditFails: true });
    const before = structuredClone(state);
    const response = await handler(request(method, payload), context());
    assert.equal(response.status, 500); assert.doesNotMatch(JSON.stringify(await response.json()), /Private SQL/);
    assert.deepEqual(state, before); assert.equal(transaction.mock.callCount(), 1);
  });
}

for (const [method, handler] of [["PATCH", PATCH], ["DELETE", DELETE], ["POST", RESTORE]] as const) {
  test(`story ${handler === RESTORE ? "restore" : method} rejects malformed versions, foreign stories and CAS races`, async (t) => {
    const row = existing(); if (handler === RESTORE) row.deletedAt = new Date(1);
    const { state, transaction } = setup(t, { stories: [row], casMiss: true });
    for (const expectedVersion of [undefined, -1, "0", 0.25, null]) {
      assert.equal((await handler(request(method, { ...base, expectedVersion }), context())).status, 400);
    }
    assert.equal(transaction.mock.callCount(), 0);
    assert.equal((await handler(request(method, { ...base, expectedVersion: 0 }), context("person", "foreign-story"))).status, 404);
    assert.equal((await handler(request(method, { ...base, expectedVersion: 0 }), context())).status, 409);
    assert.equal(state.stories[0].version, 0); assert.deepEqual(state.audits, []);
  });
}

test("story creation retries serialization with fresh permissions and aborts after revocation", async (t) => {
  const { state, permissionReads } = setup(t, { stories: [], conflictCount: 1, txRole: (attempt) => attempt === 1 ? "editor" : null });
  assert.equal((await POST(request("POST", base), context())).status, 403);
  assert.equal(permissionReads(), 2); assert.deepEqual(state.stories, []); assert.deepEqual(state.audits, []);
});

test("direct repository calls validate text/version and never retry an unknown write result", async (t) => {
  const { transaction, state } = setup(t, { writeError: new Error("Unknown network result") });
  await assert.rejects(repository.createStoryForPerson({ ...actor, ...base, body: "" }), (error: unknown) => (error as { status: number }).status === 400);
  await assert.rejects(repository.updateStoryForPerson({ ...actor, ...base, storyId: "story", expectedVersion: -1 }), (error: unknown) => (error as { status: number }).status === 400);
  assert.equal(transaction.mock.callCount(), 0);
  await assert.rejects(repository.createStoryForPerson({ ...actor, ...base }), /Unknown network result/);
  assert.equal(transaction.mock.callCount(), 1); assert.deepEqual(state.audits, []);
});
