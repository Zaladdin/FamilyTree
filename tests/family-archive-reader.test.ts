import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";

const previousUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = UNIT_DATABASE_URL;
const globals = globalThis as { prisma?: unknown };
const previousPrisma = globals.prisma;
const unexpected = async (): Promise<never> => { throw new Error("Unexpected archive database operation"); };
const prisma = { family: { findUnique: unexpected }, person: { findMany: unexpected } };
globals.prisma = prisma;
after(() => {
  if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  if (previousPrisma === undefined) delete globals.prisma; else globals.prisma = previousPrisma;
});
const requireTest = createRequire(path.resolve("tests/family-archive-reader.test.ts"));
const { getFamilyArchivePage, getFamilyJournalPage, normalizeArchiveCursor }:
  typeof import("../lib/family-archive-reader") = requireTest("../lib/family-archive-reader");

function archivedPerson(id: string) {
  return { id, firstName: "Тест", lastName: id, middleName: "", birthDate: "1900", birthPlace: "Город",
    status: "deceased", biography: "Первый абзац\n\nВторой", photosCount: 2, audioCount: 1, documentsCount: 0 };
}
type Query = { where: { familyId: string; isArchived: boolean; id?: { gt?: string; lt?: string } }; take: number; orderBy: { id: string }; select: Record<string, unknown> };

test("archive reads one bounded page and minimal header without any family graph or attachments", async (t) => {
  let header: Record<string, unknown> | undefined;
  let pageQuery: Query | undefined;
  t.mock.method(prisma.family, "findUnique", async (query: { select: Record<string, unknown> }) => {
    header = query.select;
    return { id: "family", slug: "unit", title: "Архив", people: [{ id: "active" }] };
  });
  t.mock.method(prisma.person, "findMany", async (query: Query) => {
    pageQuery = query;
    return Array.from({ length: query.take }, (_, index) => archivedPerson(`p${String(index).padStart(3, "0")}`));
  });
  const page = await getFamilyArchivePage("unit");
  assert.ok(page);
  assert.equal(page.archivedPeople.length, 24);
  assert.equal(page.pagination.nextCursor, "p023");
  assert.equal(page.pagination.previousCursor, null);
  assert.deepEqual(pageQuery?.where, { familyId: "family", isArchived: true });
  assert.equal(pageQuery?.take, 25);
  assert.deepEqual(pageQuery?.orderBy, { id: "asc" });
  assert.equal(header?.relationships, undefined);
  assert.equal(header?.auditLogs, undefined);
  assert.equal(pageQuery?.select.mediaAssets, undefined);
  assert.equal(pageQuery?.select.stories, undefined);
  assert.equal(pageQuery?.select.note, undefined);
  assert.equal(page.archivedPeople[0].biography, "Первый абзац\n\nВторой");
  assert.deepEqual(page.archivedPeople[0].media, { photos: 2, audio: 1, documents: 0 });
});

test("keyset next and previous pages are stable even after the anchor person is restored", async (t) => {
  let all = Array.from({ length: 60 }, (_, index) => archivedPerson(`p${String(index).padStart(3, "0")}`));
  const queries: Query[] = [];
  t.mock.method(prisma.family, "findUnique", async () => ({ id: "family", slug: "unit", title: "Архив", people: [] }));
  t.mock.method(prisma.person, "findMany", async (query: Query) => {
    queries.push(query);
    const candidates = all.filter((person) => (!query.where.id?.gt || person.id > query.where.id.gt)
      && (!query.where.id?.lt || person.id < query.where.id.lt));
    return (query.orderBy.id === "desc" ? candidates.reverse() : candidates).slice(0, query.take);
  });
  const first = await getFamilyArchivePage("unit");
  const second = await getFamilyArchivePage("unit", { after: first!.pagination.nextCursor! });
  assert.deepEqual(second!.archivedPeople.map((person) => person.id), all.slice(24, 48).map((person) => person.id));
  assert.equal(second!.pagination.previousCursor, "p024");
  all = all.filter((person) => person.id !== "p024");
  const previous = await getFamilyArchivePage("unit", { before: second!.pagination.previousCursor! });
  assert.deepEqual(previous!.archivedPeople.map((person) => person.id), first!.archivedPeople.map((person) => person.id));
  assert.equal(previous!.pagination.previousCursor, null);
  assert.equal(previous!.pagination.nextCursor, "p023");
  assert.ok(queries.every((query) => query.take === 25 && query.where.familyId === "family" && query.where.isArchived));
});

test("invalid or ambiguous cursors reset to the first bounded page; empty cursor pages retain recovery navigation", async (t) => {
  for (const query of [{ after: ["a", "b"] }, { after: "a", before: "b" }, { after: "" }, { before: "x".repeat(201) }, { after: "a\u0000b" }]) {
    assert.deepEqual(normalizeArchiveCursor(query), {});
  }
  t.mock.method(prisma.family, "findUnique", async () => ({ id: "family", slug: "unit", title: "Архив", people: [] }));
  t.mock.method(prisma.person, "findMany", async () => []);
  const page = await getFamilyArchivePage("unit", { after: "restored-anchor" });
  assert.equal(page!.pagination.isFiltered, true);
  assert.equal(page!.pagination.previousCursor, "restored-anchor");
  assert.equal(page!.pagination.nextCursor, null);
});

test("missing family returns null before a person query", async (t) => {
  t.mock.method(prisma.family, "findUnique", async () => null);
  assert.equal(await getFamilyArchivePage("missing"), null);
});

test("journal selects only its latest 100 events and fallback ID, never whole people or relationships", async (t) => {
  let selection: Record<string, unknown> = {};
  t.mock.method(prisma.family, "findUnique", async (query: { select: Record<string, unknown> }) => {
    selection = query.select;
    return { slug: "unit", title: "Журнал", people: [{ id: "active" }], auditLogs: [{
      id: "event", actorName: "Тест", message: "Карточка изменена", personName: null, createdAt: new Date(0),
    }] };
  });
  const page = await getFamilyJournalPage("unit");
  assert.equal(selection.relationships, undefined);
  assert.equal(selection.parentSuppressions, undefined);
  assert.deepEqual(selection.people, { where: { isArchived: false }, orderBy: { id: "asc" }, take: 1, select: { id: true } });
  assert.equal((selection.auditLogs as { take: number }).take, 100);
  assert.equal(page!.auditLog[0].createdAt, "1970-01-01T00:00:00.000Z");
  assert.equal(page!.auditLog[0].personName, undefined);
});
