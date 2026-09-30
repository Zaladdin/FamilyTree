import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";

const previousUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = UNIT_DATABASE_URL;
const globals = globalThis as { prisma?: unknown };
const previousPrisma = globals.prisma;
const unavailable = async (): Promise<unknown> => { throw new Error("Unexpected database operation"); };
const prisma = { family: { findUnique: unavailable }, person: { findUnique: unavailable } };
globals.prisma = prisma;
after(() => {
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  if (previousPrisma === undefined) delete globals.prisma;
  else globals.prisma = previousPrisma;
});
const requireTest = createRequire(path.resolve("tests/media-detail.test.ts"));
const { getFamilyBySlug }: typeof import("../lib/family-repository") = requireTest("../lib/family-repository");

test("person detail requests and exposes only ready media through protected URLs", async (t) => {
  const person = {
    id: "person", firstName: "Тест", lastName: "Пример", gender: "male", birthDate: "2000-01-01",
    birthPlace: "", status: "living", isArchived: false, biography: "", version: 0,
    photosCount: 1, audioCount: 0, documentsCount: 0,
  };
  t.mock.method(prisma.family, "findUnique", async () => ({
    id: "family", slug: "example", title: "Тест", surname: "Пример", description: "", region: "", coverQuote: "",
    peopleCount: 1, photosCount: 1, audioCount: 0, storiesCount: 0, contributorsCount: 1,
    people: [person], memberships: [], digitizationTasks: [], relationships: [], auditLogs: [],
  }));
  t.mock.method(prisma.person, "findUnique", async (query: { include: { mediaAssets: { where: { state: string } } } }) => {
    assert.deepEqual(query.include.mediaAssets.where, { state: "ready" });
    return {
      ...person, family: { slug: "example" }, stories: [], timelineEvents: [],
      mediaAssets: ["pending", "ready", "deleting", "failed"].map((state) => ({
        id: state, state, type: "photo", title: "Тест", storagePath: "storage/uploads/private.png",
        checksum: "private-hash", mimeType: "image/png", size: 42, createdAt: new Date("2026-01-01T00:00:00Z"),
      })),
    };
  });
  const family = await getFamilyBySlug("example", "person");
  assert.equal(family?.people[0].mediaAssets.length, 1);
  const media = family!.people[0].mediaAssets[0];
  assert.equal(media.id, "ready");
  assert.equal(media.url, "/api/family/example/people/person/media/ready");
  assert.equal("storagePath" in media, false);
  assert.equal("checksum" in media, false);
});
