import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  deleteUploadByStoragePath,
  detectMimeTypeForUpload,
  readUploadByStoragePath,
  saveUpload,
} from "@/lib/media-storage";

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
  const diskBytes = await readFile(absolutePath);
  const loadedBytes = await readUploadByStoragePath(stored.storagePath);

  assert.equal(diskBytes.length, pngBytes.length);
  assert.equal(Buffer.compare(diskBytes, loadedBytes), 0);

  await deleteUploadByStoragePath(stored.storagePath);
  await assert.rejects(() => readFile(absolutePath));

  await rm(path.join(process.cwd(), "storage"), {
    force: true,
    recursive: true,
  }).catch(() => undefined);
});
