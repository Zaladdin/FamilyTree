import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";

const previousUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = UNIT_DATABASE_URL;
const globals = globalThis as { prisma?: unknown };
const previousPrisma = globals.prisma;
const unexpected = async (): Promise<never> => { throw new Error("Unexpected database operation in avatar unit test"); };
const prisma = { family: { findUnique: unexpected }, person: { findUnique: unexpected } };
globals.prisma = prisma;
after(() => {
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  if (previousPrisma === undefined) delete globals.prisma;
  else globals.prisma = previousPrisma;
});
const requireTest = createRequire(path.resolve("tests/family-avatar.test.ts"));
const { getFamilyBySlug }: typeof import("../lib/family-repository") = requireTest("../lib/family-repository");

function person(id: string, isArchived = false) {
  return {
    id, firstName: "Тест", lastName: id, gender: "male", birthDate: "2000-01-01",
    birthPlace: "", status: "living", isArchived, biography: "", version: 0,
    photosCount: 1, audioCount: 1, documentsCount: 0,
  };
}
const photos = [
  { id: "older", state: "ready", type: "photo", createdAt: new Date("2026-01-01T00:00:00Z") },
  { id: "newer-a", state: "ready", type: "photo", createdAt: new Date("2026-02-01T00:00:00Z") },
  { id: "newer-z", state: "ready", type: "photo", createdAt: new Date("2026-02-01T00:00:00Z") },
  { id: "pending", state: "pending", type: "photo", createdAt: new Date("2026-03-01T00:00:00Z") },
  { id: "audio", state: "ready", type: "audio", createdAt: new Date("2026-04-01T00:00:00Z") },
];
type AvatarQuery = {
  where: { state?: string; type?: string };
  orderBy: { createdAt?: string; id?: string }[];
  take: number;
  select: { id: boolean };
};

test("family summaries expose one protected avatar per person without loading their attachments", async (t) => {
  let avatarQuery: AvatarQuery | undefined;
  t.mock.method(prisma.family, "findUnique", async (query: { include: { people: { include?: { mediaAssets?: AvatarQuery } } } }) => {
    avatarQuery = query.include.people.include?.mediaAssets;
    const selected = avatarQuery
      ? photos.filter((asset) => asset.state === avatarQuery!.where.state && asset.type === avatarQuery!.where.type)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
        .slice(0, avatarQuery.take).map(({ id }) => ({ id }))
      : [];
    return {
      id: "family", slug: "example", title: "Тест", surname: "Пример", description: "", region: "", coverQuote: "",
      peopleCount: 3, photosCount: 3, audioCount: 1, storiesCount: 0, contributorsCount: 1,
      people: [
        { ...person("focus"), mediaAssets: selected },
        { ...person("relative"), mediaAssets: selected },
        { ...person("no-photo"), mediaAssets: [] },
        { ...person("archived", true), mediaAssets: selected },
      ],
      memberships: [], digitizationTasks: [], relationships: [], auditLogs: [],
    };
  });
  t.mock.method(prisma.person, "findUnique", async () => null);
  const family = await getFamilyBySlug("example", "focus");
  assert.ok(family);
  const relative = family.people.find((item) => item.id === "relative")!;
  assert.equal(relative.avatarUrl,
    "/api/family/example/people/relative/media/newer-z");
  assert.deepEqual(relative.mediaAssets, [], "summary must not impersonate fully loaded attachments");
  assert.equal(family.people[2].avatarUrl, undefined);
  assert.equal(family.archivedPeople[0].avatarUrl,
    "/api/family/example/people/archived/media/newer-z");
  assert.deepEqual(avatarQuery, {
    where: { state: "ready", type: "photo" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { id: true },
  });
  assert.doesNotMatch(JSON.stringify(family), /storagePath|checksum/);
});

test("focused detail keeps its ready-photo avatar when summary is replaced", async (t) => {
  const focus = person("focus");
  t.mock.method(prisma.family, "findUnique", async () => ({
    id: "family", slug: "example", title: "Тест", surname: "Пример", description: "", region: "", coverQuote: "",
    peopleCount: 1, photosCount: 1, audioCount: 1, storiesCount: 0, contributorsCount: 1,
    people: [{ ...focus, mediaAssets: [{ id: "ready-photo" }] }], memberships: [], digitizationTasks: [], relationships: [], auditLogs: [],
  }));
  t.mock.method(prisma.person, "findUnique", async () => ({
    ...focus, family: { slug: "example" }, stories: [], timelineEvents: [],
    mediaAssets: [
      { id: "pending-photo", state: "pending", type: "photo" },
      { id: "ready-audio", state: "ready", type: "audio" },
      { id: "ready-photo", state: "ready", type: "photo" },
    ].map((asset) => ({ ...asset, title: "Тест", storagePath: "private", checksum: "secret",
      mimeType: "image/png", size: 42, createdAt: new Date("2026-01-01T00:00:00Z") })),
  }));
  const family = await getFamilyBySlug("example", "focus");
  assert.equal(family?.people[0].avatarUrl,
    "/api/family/example/people/focus/media/ready-photo");
  assert.equal(family?.people[0].mediaAssets.length, 2);
});
