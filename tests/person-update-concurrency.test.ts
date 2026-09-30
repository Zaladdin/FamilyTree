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
const prisma = { family: { findUnique: unexpected }, person: { findUnique: unexpected }, $transaction: unexpected };
globalPrisma.prisma = prisma;
after(() => {
  if (previousPrisma === undefined) delete globalPrisma.prisma;
  else globalPrisma.prisma = previousPrisma;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
});
const requireTest = createRequire(path.resolve("tests/person-update-concurrency.test.ts"));
const { updatePersonInFamily, getFamilyJournalBySlug, getFamilyBySlug }: typeof import("../lib/family-repository") = requireTest("../lib/family-repository");
const input = {
  firstName: "Изменено", lastName: "Тест", gender: "male" as const, birthDate: "1990",
  birthPlace: "Баку", biography: "Черновик", status: "living" as const, expectedVersion: 0,
};
const status = (expected: number) => (error: unknown) => error instanceof HttpError && error.status === expected;
const conflict = (code = "P2034") => new Prisma.PrismaClientKnownRequestError("Synthetic conflict", { code, clientVersion: "unit" });
function rawFamily() {
  return {
    id: "unit", slug: "unit", title: "Тест", surname: "Тест", description: "", region: "", coverQuote: "",
    peopleCount: 1, photosCount: 0, audioCount: 0, storiesCount: 0, contributorsCount: 1,
    people: [{ id: "first", familyId: "unit", firstName: "Старое", lastName: "Тест", middleName: "", gender: "male",
      birthDate: "1990", deathDate: null, birthPlace: "Баку", status: "living", isArchived: false,
      biography: "", note: null, photosCount: 0, audioCount: 0, documentsCount: 0,
      memoryTitle: null, memoryNarrator: null, memoryDuration: null, memorySummary: null, version: 0 }],
    memberships: [], relationships: [], digitizationTasks: [], auditLogs: [],
  };
}
function install(t: TestContext, options: { onConflict?: (state: State) => void; updateError?: Error; failAudit?: boolean } = {}) {
  const state = { family: rawFamily(), role: "editor", attempts: 0, outsideReads: 0, audits: [] as unknown[] };
  t.mock.method(prisma.family, "findUnique", async () => { state.outsideReads++; return structuredClone(state.family); });
  t.mock.method(prisma, "$transaction", async (run: (tx: unknown) => Promise<unknown>, txOptions?: { isolationLevel: string }) => {
    state.attempts++;
    const pending = structuredClone(state);
    const tx = {
      family: { findUnique: async () => pending.family },
      familyMembership: { findFirst: async ({ where }: { where: { userId: string; familyId: string } }) => {
        assert.deepEqual(where, { familyId: "unit", userId: "actor" });
        return { role: pending.role };
      } },
      person: { update: async ({ where, data }: { where: { id: string; familyId?: string; version?: number; isArchived?: boolean }; data: Record<string, unknown> }) => {
        if (options.updateError) throw options.updateError;
        const person = pending.family.people.find((p) => p.id === where.id)!;
        if (where.version !== undefined && where.version !== person.version) throw conflict("P2025");
        assert.equal(where.version, input.expectedVersion, "write must compare expected version atomically");
        assert.equal(where.familyId, "unit");
        assert.equal(where.isArchived, false);
        const version = person.version + ((data.version as { increment: number })?.increment ?? 0);
        Object.assign(person, data, { version });
        return person;
      } },
      auditLog: { create: async ({ data }: { data: unknown }) => {
        if (options.failAudit) throw new Error("Synthetic audit failure");
        pending.audits.push(data);
      } },
    };
    const result = await run(tx);
    if (state.attempts === 1 && options.onConflict) { options.onConflict(state); throw conflict(); }
    assert.equal(txOptions?.isolationLevel, "Serializable");
    state.family = pending.family;
    state.audits = pending.audits;
    return result;
  });
  return state;
}
type State = ReturnType<typeof install>;

test("card update compares revision, advances it and audits in one transaction", async (t) => {
  const state = install(t);
  const person = await updatePersonInFamily("unit", "first", input, "Тест", "actor");
  assert.equal(person.version, 1);
  assert.equal(state.family.people[0].firstName, "Изменено");
  assert.equal(state.family.people[0].version, 1);
  assert.equal(state.audits.length, 1);
  assert.equal(state.outsideReads, 0);
});

test("person repository preserves biography and note paragraphs through persistence", async (t) => {
  const state = install(t);
  const person = await updatePersonInFamily("unit", "first", { ...input,
    biography: "  Первый абзац.\r\n\r\nВторой  абзац.  ", note: "Заметка\rСледующая строка",
  }, "Тест", "actor");
  assert.equal(person.biography, "Первый абзац.\n\nВторой  абзац.");
  assert.equal(person.note, "Заметка\nСледующая строка");
  assert.equal(state.family.people[0].biography, person.biography);
});

test("family detail hides removed stories by default and exposes restore metadata only on editor request", async (t) => {
  const state = install(t);
  const removedAt = new Date("2026-09-01T00:00:00Z");
  const stories = [
    { id: "live", title: "Активная", body: "Абзац\n\nДругой", narrator: null, createdAt: new Date(0), version: 2, deletedAt: null },
    { id: "removed", title: "Удалённая", body: "Сохранённый текст", narrator: null, createdAt: new Date(0), version: 3, deletedAt: removedAt },
  ];
  const reads: unknown[] = [];
  t.mock.method(prisma.person, "findUnique", async (query: unknown) => {
    reads.push(query);
    return { ...state.family.people[0], family: { slug: "unit" }, stories, mediaAssets: [],
      timelineEvents: [{ kind: "birth", label: "1980 - рождение" }, { kind: "custom", label: "Семейное событие" }],
    };
  });
  const ordinary = await getFamilyBySlug("unit", "first");
  assert.deepEqual(ordinary?.people[0].stories.map((story) => story.id), ["live"]);
  assert.equal(ordinary?.people[0].deletedStories, undefined);
  assert.deepEqual((reads[0] as { include: { stories: { where: unknown } } }).include.stories.where, { deletedAt: null });
  const editor = await getFamilyBySlug("unit", "first", { includeDeletedStories: true });
  assert.equal(editor?.people[0].deletedStories?.[0].version, 3);
  assert.equal(editor?.people[0].deletedStories?.[0].deletedAt, removedAt.toISOString());
  assert.equal(editor?.people[0].stories[0].body, "Абзац\n\nДругой");
  assert.deepEqual(editor?.people[0].timeline, ["1990 - рождение", "Семейное событие"]);
});

test("second editor's stale draft cannot overwrite first editor's committed fields", async (t) => {
  const state = install(t);
  await updatePersonInFamily("unit", "first", input, "Тест", "actor");
  await assert.rejects(updatePersonInFamily("unit", "first", { ...input, firstName: "Перезапись" }, "Тест", "actor"), status(409));
  assert.equal(state.family.people[0].firstName, "Изменено");
  assert.equal(state.audits.length, 1);
});

for (const change of ["version", "archive", "role"] as const) {
  test(`retry rechecks concurrent ${change} change`, async (t) => {
    const state = install(t, { onConflict: (s) => {
      if (change === "version") { s.family.people[0].version++; s.family.people[0].firstName = "Другой редактор"; }
      if (change === "archive") { s.family.people[0].version++; s.family.people[0].isArchived = true; }
      if (change === "role") s.role = "guest";
    } });
    await assert.rejects(updatePersonInFamily("unit", "first", input, "Тест", "actor"), status(change === "role" ? 403 : change === "archive" ? 404 : 409));
    assert.equal(state.attempts, 2);
    assert.equal(state.audits.length, 0);
  });
}

for (const code of ["P2025", "P2002"]) {
  test(`maps atomic ${code} conflict to 409 with no audit`, async (t) => {
    const state = install(t, { updateError: conflict(code) });
    await assert.rejects(updatePersonInFamily("unit", "first", input, "Тест", "actor"), status(409));
    assert.equal(state.audits.length, 0);
    assert.equal(state.attempts, 1);
  });
}

test("audit failure rolls back both card and version", async (t) => {
  const state = install(t, { failAudit: true });
  await assert.rejects(updatePersonInFamily("unit", "first", input, "Тест", "actor"), /Synthetic audit failure/);
  assert.equal(state.family.people[0].version, 0);
  assert.equal(state.family.people[0].firstName, "Старое");
});

test("family response carries version for editor forms", async (t) => {
  install(t);
  const family = await getFamilyJournalBySlug("unit");
  assert.equal(family?.people[0].version, 0);
});
