import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  deleteUploadByStoragePath,
  detectMimeTypeForUpload,
  readUploadByStoragePath,
  saveUpload,
  assertUploadSizeWithinLimit,
} from "@/lib/media-storage";

const originalCwd = process.cwd();
const previousStorageRoot = process.env.MEDIA_STORAGE_ROOT;
let temporaryParent: string;
let temporaryWorkspace: string | undefined;

before(async () => {
  temporaryParent = await realpath(tmpdir());
  temporaryWorkspace = await mkdtemp(path.join(temporaryParent, "rodovo-media-tests-"));
  // Node's test runner isolates this file in its own process. The production
  // storage API resolves paths from cwd, so every write stays in this fixture.
  process.chdir(temporaryWorkspace);
  delete process.env.MEDIA_STORAGE_ROOT;
});

after(async () => {
  process.chdir(originalCwd);
  if (previousStorageRoot === undefined) delete process.env.MEDIA_STORAGE_ROOT; else process.env.MEDIA_STORAGE_ROOT = previousStorageRoot;
  if (!temporaryWorkspace) return;
  const cleanupTarget = await realpath(temporaryWorkspace);
  // Resolve and validate the exact, uniquely created child before recursive removal.
  assert.equal(path.dirname(cleanupTarget), temporaryParent);
  assert.match(path.basename(cleanupTarget), /^rodovo-media-tests-.+$/);
  assert.notEqual(cleanupTarget, originalCwd);
  await rm(cleanupTarget, { force: true, recursive: true });
});

const pngBytes = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d,
]);

const textBytes = Uint8Array.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]);

test("detectMimeTypeForUpload recognizes png signature by content", () => {
  const mimeType = detectMimeTypeForUpload(pngBytes, "photo");

  assert.equal(mimeType, "image/png");
});

test("saveUpload rejects files with invalid binary content even if client mime is allowed", async () => {
  const fakeImage = new File([textBytes], "fake.png", { type: "image/png" });

  await assert.rejects(
    () =>
      saveUpload({
        familySlug: "akhmedov",
        personId: "timur",
        type: "photo",
        file: fakeImage,
      }),
    /Не удалось подтвердить формат изображения/,
  );
});

test("saveUpload stores file in private storage and read/delete helpers work", async () => {
  const file = new File([pngBytes], "photo.png", { type: "image/png" });
  const stored = await saveUpload({
    familySlug: "akhmedov",
    personId: "timur",
    type: "photo",
    file,
  });

  assert.match(stored.storagePath, /storage[\\/]+uploads[\\/]+akhmedov[\\/]+timur[\\/]+photo[\\/]+/);
  assert.equal(stored.mimeType, "image/png");

  const absolutePath = path.join(process.cwd(), stored.storagePath);
  assert.equal(process.cwd(), temporaryWorkspace);
  assert.ok(absolutePath.startsWith(temporaryWorkspace + path.sep));
  const diskBytes = await readFile(absolutePath);
  const loadedBytes = await readUploadByStoragePath(stored.storagePath);

  assert.equal(diskBytes.length, pngBytes.length);
  assert.equal(Buffer.compare(diskBytes, loadedBytes), 0);

  await deleteUploadByStoragePath(stored.storagePath);
  await assert.rejects(() => readFile(absolutePath));

});

test("upload size limits allow their boundary and reject empty or oversized files before reading", async () => {
  assert.doesNotThrow(() => assertUploadSizeWithinLimit(10 * 1024 * 1024, "photo"));
  assert.doesNotThrow(() => assertUploadSizeWithinLimit(20 * 1024 * 1024, "audio"));
  assert.throws(() => assertUploadSizeWithinLimit(0, "photo"), /пустой/);
  assert.throws(() => assertUploadSizeWithinLimit(20 * 1024 * 1024 + 1, "audio"), /20 MB/);
  let wasRead = false;
  const oversizedFile = {
    size: 10 * 1024 * 1024 + 1,
    arrayBuffer: async () => { wasRead = true; return new ArrayBuffer(0); },
  } as File;
  await assert.rejects(
    () => saveUpload({ familySlug: "test-family", personId: "test-person", type: "photo", file: oversizedFile }),
    /10 MB/,
  );
  assert.equal(wasRead, false);
});

test("upload paths reject traversal before reading any file bytes", async () => {
  let wasRead = false;
  const file = {
    size: 12,
    arrayBuffer: async () => { wasRead = true; return new ArrayBuffer(12); },
  } as File;
  for (const segment of ["..", "../outside", "..\\outside", "a/b", "a\\b"]) {
    await assert.rejects(
      () => saveUpload({ familySlug: segment, personId: "test-person", type: "photo", file }),
      /Недопустимое значение/,
    );
    await assert.rejects(
      () => saveUpload({ familySlug: "test-family", personId: segment, type: "photo", file }),
      /Недопустимое значение/,
    );
  }
  assert.equal(wasRead, false);
});

test("private media helpers reject paths outside the current isolated storage root", async () => {
  for (const invalidPath of ["../outside.txt", "storage/../../outside.txt", "storage\\..\\..\\outside.txt", "storage-other/file.txt"]) {
    await assert.rejects(() => readUploadByStoragePath(invalidPath), /Неверный путь/);
    await assert.rejects(() => deleteUploadByStoragePath(invalidPath), /Неверный путь/);
  }
});
