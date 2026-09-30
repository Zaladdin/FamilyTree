import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";

const previousUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = UNIT_DATABASE_URL;
const globalPrisma = globalThis as { prisma?: unknown };
const previousPrisma = globalPrisma.prisma;
const unexpected = async (..._args: unknown[]): Promise<unknown> => { throw new Error("Unexpected dependency call"); };
const prisma = { mediaAsset: { findMany: unexpected, deleteMany: unexpected } };
globalPrisma.prisma = prisma;
const requireTest = createRequire(path.resolve("tests/media-storage-diagnostics.test.ts"));
const storageId = requireTest.resolve("../lib/media-storage");
const originalStorage = requireTest(storageId);
const storage = { listStorageKeys: unexpected, statUploadByStoragePath: unexpected, deleteUploadByStoragePath: unexpected };
requireTest.cache[storageId]!.exports = storage;
const { inspectMediaStorage }: typeof import("../lib/media-storage-diagnostics") = requireTest("../lib/media-storage-diagnostics");
after(() => {
  if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  if (previousPrisma === undefined) delete globalPrisma.prisma; else globalPrisma.prisma = previousPrisma;
  requireTest.cache[storageId]!.exports = originalStorage;
});

test("storage diagnostics count missing originals and unknown files without attempting deletion", async (t) => {
  const rows = [
    { storagePath: "storage/uploads/ready.png", state: "ready" },
    { storagePath: "storage/uploads/missing.png", state: "ready" },
    { storagePath: "storage/uploads/pending.png", state: "pending" },
  ];
  t.mock.method(prisma.mediaAsset, "findMany", async ({ take }: { take: number }) => { assert.equal(take, 10_001); return rows; });
  t.mock.method(storage, "listStorageKeys", async () => ["storage/uploads/ready.png", "storage/uploads/pending.png.partial", "storage/uploads/unknown.png"]);
  t.mock.method(storage, "statUploadByStoragePath", async (key: string) => {
    if (!key.endsWith("/ready.png")) throw Object.assign(new Error("Missing synthetic original"), { code: "ENOENT" });
    return { size: 12 };
  });
  assert.deepEqual(await inspectMediaStorage(), { recorded: 3, files: 3, missingReady: 1, missingOther: 1, duplicateKeys: 0, partial: 1, orphan: 1 });
});

test("diagnostics stop before filesystem traversal when the bounded database inventory overflows", async (t) => {
  t.mock.method(prisma.mediaAsset, "findMany", async () => Array.from({ length: 10_001 }, () => ({ storagePath: "unused", state: "ready" })));
  await assert.rejects(inspectMediaStorage(), /inventory limit/);
});

test("diagnostics never classify denied access or unsafe storage paths as ordinary missing files", async (t) => {
  t.mock.method(prisma.mediaAsset, "findMany", async () => [{ storagePath: "storage/uploads/denied.png", state: "ready" }]);
  t.mock.method(storage, "listStorageKeys", async () => []);
  t.mock.method(storage, "statUploadByStoragePath", async () => { throw Object.assign(new Error("Synthetic permission failure"), { code: "EACCES" }); });
  await assert.rejects(inspectMediaStorage(), /Synthetic permission/);
});
