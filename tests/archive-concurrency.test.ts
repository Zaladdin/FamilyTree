import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { HttpError } from "@/lib/http-error";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";

const previousUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = UNIT_DATABASE_URL;
const globalPrisma = globalThis as { prisma?: unknown };
const previousPrisma = globalPrisma.prisma;
const unexpected = async (..._args: unknown[]): Promise<unknown> => { throw new Error("Unexpected database operation"); };
const prisma = { family: { findUnique: unexpected }, person: { findFirst: unexpected, count: unexpected }, $transaction: unexpected };
globalPrisma.prisma = prisma;
after(() => {
  if (previousPrisma === undefined) delete globalPrisma.prisma;
  else globalPrisma.prisma = previousPrisma;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
});
const requireTest = createRequire(path.resolve("tests/archive-concurrency.test.ts"));
const { archivePersonInFamily, restorePersonInFamily }: typeof import("../lib/family-repository") = requireTest("../lib/family-repository");
const params = { slug: "unit-family", personId: "first", actorUserId: "editor", actorName: "Тест" };
const status = (expected: number) => (error: unknown) => error instanceof HttpError && error.status === expected;
const conflict = () => new Prisma.PrismaClientKnownRequestError("Synthetic conflict", { code: "P2034", clientVersion: "unit" });

function install(t: TestContext, options: { archived?: boolean; onConflict?: (state: State) => void; failAudit?: boolean } = {}) {
  const state = {
    people: [
      { id: "first", familyId: "unit-family", firstName: "Первый", middleName: "", lastName: "Тест", isArchived: options.archived ?? false, version: 0 },
      { id: "second", familyId: "unit-family", firstName: "Второй", middleName: "", lastName: "Тест", isArchived: false, version: 0 },
    ],
    role: "editor", audits: [] as Record<string, unknown>[], peopleCount: options.archived ? 1 : 2, attempts: 0, outsideReads: 0,
  };
  t.mock.method(prisma.family, "findUnique", async () => { state.outsideReads++; return { id: "unit-family" }; });
  t.mock.method(prisma.person, "findFirst", async ({ where }: { where: { id: string; familyId: string } }) => {
    state.outsideReads++;
    return state.people.find((p) => p.id === where.id && p.familyId === where.familyId) ?? null;
  });
  t.mock.method(prisma.person, "count", async () => { state.outsideReads++; return state.people.filter((p) => !p.isArchived).length; });
  t.mock.method(prisma, "$transaction", async (run: (tx: unknown) => Promise<unknown>, txOptions?: { isolationLevel: string }) => {
    state.attempts++;
    const pending = structuredClone(state);
    const tx = {
      family: {
        findUnique: async ({ where }: { where: { slug: string } }) => where.slug === "unit-family" ? { id: "unit-family" } : null,
        update: async ({ data }: { data: { peopleCount: number } }) => { pending.peopleCount = data.peopleCount; },
      },
      familyMembership: {
        findFirst: async ({ where }: { where: { familyId: string; userId: string } }) => {
          assert.deepEqual(where, { familyId: "unit-family", userId: "editor" });
          return pending.role ? { role: pending.role } : null;
        },
        count: async () => 1,
      },
      person: {
        findFirst: async ({ where }: { where: { id: string; familyId: string } }) => pending.people.find((p) => p.id === where.id && p.familyId === where.familyId) ?? null,
        count: async () => pending.people.filter((p) => !p.isArchived).length,
        update: async ({ where, data }: { where: { id: string }; data: { isArchived: boolean; version?: { increment: number } } }) => {
          const person = pending.people.find((p) => p.id === where.id)!;
          person.isArchived = data.isArchived;
          person.version += data.version?.increment ?? 0;
          return person;
        },
      },
      mediaAsset: { count: async ({ where }: { where: { type: string; state?: string; person: { familyId: string; isArchived: boolean } } }) => {
        assert.equal(where.state, "ready", "archive/restore counters must exclude pending, failed and deleting originals");
        assert.deepEqual(where.person, { familyId: "unit-family", isArchived: false });
        return 0;
      } }, story: { count: async ({ where }: { where: { deletedAt?: null; person: { familyId: string; isArchived: boolean } } }) => {
        assert.deepEqual(where, { person: { familyId: "unit-family", isArchived: false }, deletedAt: null }, "archiving/restoring people must never count removed stories");
        return 0;
      } },
      auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => {
        if (options.failAudit) throw new Error("Synthetic audit failure");
        pending.audits.push(data);
      } },
    };
    const result = await run(tx);
    if (state.attempts === 1 && options.onConflict) {
      options.onConflict(state);
      throw conflict();
    }
    assert.equal(txOptions?.isolationLevel, "Serializable", "archive decisions must be serializable");
    state.people = pending.people;
    state.audits = pending.audits;
    state.peopleCount = pending.peopleCount;
    return result;
  });
  return state;
}
type State = ReturnType<typeof install>;

test("archive reads/checks/writes and logs once inside a serializable transaction", async (t) => {
  const state = install(t);
  assert.equal(await archivePersonInFamily(params), "first");
  assert.equal(state.outsideReads, 0);
  assert.equal(state.people[0].isArchived, true);
  assert.equal(state.people[0].version, 1);
  assert.equal(state.peopleCount, 1);
  assert.equal(state.audits.length, 1);
});

test("retry rechecks active count after another of the last two people was archived", async (t) => {
  const state = install(t, { onConflict: (s) => { s.people[1].isArchived = true; s.peopleCount = 1; } });
  await assert.rejects(archivePersonInFamily(params), status(409));
  assert.equal(state.attempts, 2);
  assert.equal(state.people[0].isArchived, false);
  assert.equal(state.peopleCount, 1);
  assert.equal(state.audits.length, 0);
});

for (const restore of [false, true]) {
  test(`${restore ? "restore" : "archive"} rechecks revoked authorization after conflict`, async (t) => {
    const state = install(t, { archived: restore, onConflict: (s) => { s.role = "guest"; } });
    await assert.rejects((restore ? restorePersonInFamily : archivePersonInFamily)(params), status(403));
    assert.equal(state.attempts, 2);
    assert.equal(state.people[0].isArchived, restore);
    assert.equal(state.audits.length, 0);
  });

  test(`${restore ? "restore" : "archive"} repeat returns 409 without another audit/version change`, async (t) => {
    const state = install(t, { archived: restore });
    const action = restore ? restorePersonInFamily : archivePersonInFamily;
    await action(params);
    await assert.rejects(action(params), status(409));
    assert.equal(state.audits.length, 1);
    assert.equal(state.people[0].version, 1);
    assert.equal(state.peopleCount, restore ? 2 : 1);
  });
}

test("foreign person IDs are rejected before mutation", async (t) => {
  const state = install(t);
  await assert.rejects(archivePersonInFamily({ ...params, personId: "foreign" }), status(404));
  assert.equal(state.audits.length, 0);
});

test("audit failure rolls archive and counters back together", async (t) => {
  const state = install(t, { failAudit: true });
  await assert.rejects(archivePersonInFamily(params), /Synthetic audit failure/);
  assert.equal(state.people[0].isArchived, false);
  assert.equal(state.people[0].version, 0);
  assert.equal(state.peopleCount, 2);
  assert.equal(state.audits.length, 0);
  assert.equal(state.attempts, 1);
});
