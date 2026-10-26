import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";

const previousUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = UNIT_DATABASE_URL;
const globals = globalThis as { prisma?: unknown };
const previousPrisma = globals.prisma;
const unexpected = async (): Promise<never> => { throw new Error("Unexpected database operation"); };
const prisma = { family: { findUnique: unexpected }, person: { findUnique: unexpected, findMany: unexpected } };
globals.prisma = prisma;
after(() => {
  if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  if (previousPrisma === undefined) delete globals.prisma; else globals.prisma = previousPrisma;
});
const requireTest = createRequire(path.resolve("tests/family-workspace-read.test.ts"));
const { getFamilyWorkspaceBySlug }: typeof import("../lib/family-workspace-reader") = requireTest("../lib/family-workspace-reader");

function person(id: string, isArchived = false) {
  return { id, familyId: "family", version: 2, firstName: "Тест", lastName: id, middleName: "", gender: "male",
    birthDate: "1990", deathDate: null, birthPlace: "Город", status: "living", isArchived,
    biography: "Не передавать в summary", note: "Личная заметка", memoryTitle: "Запись", memorySummary: "Личный текст",
    photosCount: 1, audioCount: 0, documentsCount: 0, mediaAssets: [{ id: "photo" }] };
}
function rawFamily(people = [person("selected"), person("other")]) {
  return { id: "family", slug: "unit", title: "Тест", surname: "Тест", description: "", region: "", coverQuote: "",
    peopleCount: people.length, photosCount: 1, audioCount: 0, storiesCount: 0, contributorsCount: 1,
    people, relationships: [], auditLogs: [] };
}

test("workspace overview selects compact active summaries and does not fetch an implicit first person's detail", async (t) => {
  t.mock.method(prisma.family, "findUnique", async (query: { select: Record<string, any> }) => {
    const selected = query.select.people.select;
    for (const field of ["biography", "note", "memoryTitle", "memorySummary", "stories", "timelineEvents"]) assert.equal(selected[field], undefined);
    assert.deepEqual(query.select.people.where, { isArchived: false });
    assert.equal(query.select.auditLogs.take, 4);
    assert.equal(query.select.memberships, undefined);
    return rawFamily();
  });
  const family = await getFamilyWorkspaceBySlug("unit");
  assert.equal(family?.people.length, 2);
  assert.equal(family?.people[0].detailsLoaded, false);
  assert.equal(family?.people[0].avatarUrl, "/api/family/unit/people/selected/media/photo");
  assert.deepEqual(family?.archivedPeople, []);
  assert.doesNotMatch(JSON.stringify(family), /Не передавать|Личная заметка|Личный текст/);
});

test("selected detail is scoped to the active person in this family and keeps complete editable text", async (t) => {
  t.mock.method(prisma.family, "findUnique", async () => rawFamily());
  t.mock.method(prisma.person, "findUnique", async (query: { where: unknown }) => {
    assert.deepEqual(query.where, { id: "selected", familyId: "family", isArchived: false });
    return { ...person("selected"), family: { slug: "unit" }, mediaAssets: [], stories: [], timelineEvents: [] };
  });
  const family = await getFamilyWorkspaceBySlug("unit", "selected", { canEdit: true });
  assert.equal(family?.people[0].detailsLoaded, true);
  assert.equal(family?.people[0].biography, "Не передавать в summary");
  assert.equal(family?.people[0].note, "Личная заметка");
  assert.equal(family?.people[1].biography, "");
});

test("editor loads only archived endpoints needed to correct the selected person's exact recorded links", async (t) => {
  const edge = { id: "edge", version: 3, type: "parent", fromPersonId: "archived-parent", toPersonId: "selected", origin: "manual", sourcePersonId: null };
  t.mock.method(prisma.family, "findUnique", async () => ({ ...rawFamily(), relationships: [edge] }));
  t.mock.method(prisma.person, "findUnique", async () => ({ ...person("selected"), family: { slug: "unit" }, mediaAssets: [], stories: [], timelineEvents: [] }));
  t.mock.method(prisma.person, "findMany", async (query: { where: unknown }) => {
    assert.deepEqual(query.where, { familyId: "family", isArchived: true, id: { in: ["archived-parent"] } });
    return [person("archived-parent", true)];
  });
  const family = await getFamilyWorkspaceBySlug("unit", "selected", { canEdit: true });
  assert.equal(family?.archivedPeople.length, 1);
  assert.deepEqual(family?.recordedRelationships, [edge].map(({ sourcePersonId, ...value }) => value));
  assert.deepEqual(family?.relationships, []);
});

test("unknown or archived selection does not load detail or unrelated archived records", async (t) => {
  t.mock.method(prisma.family, "findUnique", async () => rawFamily());
  const family = await getFamilyWorkspaceBySlug("unit", "unknown", { canEdit: true });
  assert.ok(family?.people.every((item) => item.detailsLoaded === false));
  assert.deepEqual(family?.archivedPeople, []);
});

test("large synthetic overview excludes long texts while preserving the complete active graph", async (t) => {
  const people = Array.from({ length: 1000 }, (_, index) => ({ ...person(`p-${index}`), biography: "б".repeat(4096), note: "н".repeat(2048) }));
  const source = rawFamily(people);
  t.mock.method(prisma.family, "findUnique", async () => source);
  const family = await getFamilyWorkspaceBySlug("unit");
  const before = Buffer.byteLength(JSON.stringify(source));
  const after = Buffer.byteLength(JSON.stringify(family));
  assert.equal(family?.people.length, 1000, "all active people remain available to the graph");
  assert.ok(after < before / 5, `expected smaller payload, got ${after}/${before}`);
  console.log(`Synthetic workspace JSON bytes: ${before} -> ${after}`);
});

test("a selected person archived during loading produces a recoverable error instead of an endless loading card", async (t) => {
  t.mock.method(prisma.family, "findUnique", async () => rawFamily());
  t.mock.method(prisma.person, "findUnique", async () => null);
  await assert.rejects(getFamilyWorkspaceBySlug("unit", "selected"), /Карточка изменилась/);
});
