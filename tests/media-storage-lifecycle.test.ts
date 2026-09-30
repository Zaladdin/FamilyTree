import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";
import { prepareUpload, writePreparedUpload, readUploadByStoragePath, deleteUploadByStoragePath, listStorageKeys, statUploadByStoragePath } from "@/lib/media-storage";

let root: string; let parent: string;
const previousRoot = process.env.MEDIA_STORAGE_ROOT;
const originalCwd = process.cwd();
const filesystem: typeof import("node:fs/promises") = createRequire(path.resolve("tests/media-storage-lifecycle.test.ts"))("node:fs/promises");
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
before(async () => { parent = await realpath(tmpdir()); root = await mkdtemp(path.join(parent, "rodovo-media-lifecycle-")); process.chdir(root); process.env.MEDIA_STORAGE_ROOT = path.join(root, "persistent"); });
after(async () => {
  process.chdir(originalCwd);
  if (previousRoot === undefined) delete process.env.MEDIA_STORAGE_ROOT; else process.env.MEDIA_STORAGE_ROOT = previousRoot;
  const target = await realpath(root); assert.equal(path.dirname(target), parent); assert.match(path.basename(target), /^rodovo-media-lifecycle-/); await rm(target, { recursive: true, force: true });
});
const prepare = () => prepareUpload({ familySlug: "test", personId: "person", type: "photo", file: new File([png], "photo.png") });
const diskPath = (key: string) => path.join(process.env.MEDIA_STORAGE_ROOT!, key.replace(/^storage[\\/]/, ""));

test("preparation allocates key and checksum without writing; publication survives reopening with configured root", async () => {
  const prepared = await prepare(); assert.match(prepared.checksum, /^[a-f0-9]{64}$/); assert.equal(prepared.size, png.length);
  await assert.rejects(lstat(diskPath(prepared.storagePath)), { code: "ENOENT" });
  await writePreparedUpload(prepared);
  assert.deepEqual(await readUploadByStoragePath(prepared.storagePath), Buffer.from(png));
  assert.equal((await statUploadByStoragePath(prepared.storagePath)).size, png.length);
  assert.deepEqual((await listStorageKeys()).filter((key) => key === prepared.storagePath), [prepared.storagePath]);
  await assert.rejects(lstat(`${diskPath(prepared.storagePath)}.partial`), { code: "ENOENT" });
});
test("publication never replaces an existing immutable file and cleanup removes only the known final and partial keys", async () => {
  const prepared = await prepare(); const filePath = diskPath(prepared.storagePath);
  await mkdir(path.dirname(filePath), { recursive: true }); await writeFile(filePath, "original");
  await assert.rejects(writePreparedUpload(prepared), { code: "EEXIST" });
  assert.equal(await readFile(filePath, "utf8"), "original");
  const unknown = `${filePath}.unknown`; await writeFile(unknown, "leave alone");
  await deleteUploadByStoragePath(prepared.storagePath); await deleteUploadByStoragePath(prepared.storagePath);
  await assert.rejects(lstat(filePath), { code: "ENOENT" }); await assert.rejects(lstat(`${filePath}.partial`), { code: "ENOENT" });
  assert.equal(await readFile(unknown, "utf8"), "leave alone");
});
test("storage rejects traversal, alternate streams and non-upload keys", async () => {
  for (const key of ["storage/uploads/../secret", "storage/uploads/a/../../secret", "storage/uploads/a/file:stream", "storage/private.json", "C:/secret", "storage/uploads/a//file"]) {
    await assert.rejects(readUploadByStoragePath(key)); await assert.rejects(deleteUploadByStoragePath(key));
  }
});
test("storage rejects directory junctions for read, write and cleanup", async () => {
  const outside = path.join(root, "outside"); await mkdir(outside); await writeFile(path.join(outside, "private.png"), png);
  const uploads = path.join(process.env.MEDIA_STORAGE_ROOT!, "uploads"); await mkdir(uploads, { recursive: true });
  await symlink(outside, path.join(uploads, "linked"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(readUploadByStoragePath("storage/uploads/linked/private.png"), /ссыл|пут/i);
  await assert.rejects(deleteUploadByStoragePath("storage/uploads/linked/private.png"), /ссыл|пут/i);
  const prepared = await prepareUpload({ familySlug: "linked", personId: "person", type: "photo", file: new File([png], "photo.png") });
  await assert.rejects(writePreparedUpload(prepared), /ссыл|пут/i);
  assert.deepEqual(await readFile(path.join(outside, "private.png")), Buffer.from(png));
  await rm(path.join(uploads, "linked"));
});
test("prepared upload rejects a mismatch in actual bytes and declared file size before reservation", async () => {
  const file = { size: 1, arrayBuffer: async () => png.buffer, name: "mismatch.png" } as File;
  await assert.rejects(prepareUpload({ familySlug: "test", personId: "person", type: "photo", file }), /Размер файла изменился/);
});
test("exclusive partial creation failure leaves the previous attempt available for durable cleanup", async () => {
  const prepared = await prepare(); const filePath = diskPath(prepared.storagePath);
  await mkdir(path.dirname(filePath), { recursive: true }); await writeFile(`${filePath}.partial`, "interrupted attempt");
  await assert.rejects(writePreparedUpload(prepared), { code: "EEXIST" });
  assert.equal(await readFile(`${filePath}.partial`, "utf8"), "interrupted attempt");
  await assert.rejects(lstat(filePath), { code: "ENOENT" });
  await deleteUploadByStoragePath(prepared.storagePath); await assert.rejects(lstat(`${filePath}.partial`), { code: "ENOENT" });
});
test("prepared bytes cannot be changed after a quota reservation", async () => {
  const prepared = await prepare(); prepared.bytes[8] ^= 1;
  await assert.rejects(writePreparedUpload(prepared), /изменился/);
  await assert.rejects(lstat(diskPath(prepared.storagePath)), { code: "ENOENT" });
});
test("an interrupted write preserves its known partial and closes the descriptor for later cleanup", async (t) => {
  const prepared = await prepare(); const realOpen = filesystem.open; let closed = false;
  t.mock.method(filesystem, "open", async (...args: Parameters<typeof filesystem.open>) => {
    const handle = await realOpen(...args); const realClose = handle.close.bind(handle);
    t.mock.method(handle, "writeFile", async () => { await handle.write(new Uint8Array([1])); throw new Error("Simulated disk failure"); });
    t.mock.method(handle, "close", async () => { await realClose(); closed = true; }); return handle;
  });
  await assert.rejects(writePreparedUpload(prepared), /Simulated disk failure/); assert.equal(closed, true);
  const filePath = diskPath(prepared.storagePath); assert.equal((await readFile(`${filePath}.partial`)).length, 1);
  await assert.rejects(lstat(filePath), { code: "ENOENT" });
  await deleteUploadByStoragePath(prepared.storagePath); await assert.rejects(lstat(`${filePath}.partial`), { code: "ENOENT" });
});
test("a filesystem deletion failure propagates and the same known key can be retried", async (t) => {
  const prepared = await prepare(); await writePreparedUpload(prepared);
  const mocked = t.mock.method(filesystem, "unlink", async () => { throw Object.assign(new Error("Simulated permissions failure"), { code: "EACCES" }); });
  await assert.rejects(deleteUploadByStoragePath(prepared.storagePath), { code: "EACCES" });
  assert.equal((await lstat(diskPath(prepared.storagePath))).size, prepared.size);
  mocked.mock.restore(); await deleteUploadByStoragePath(prepared.storagePath);
  await assert.rejects(lstat(diskPath(prepared.storagePath)), { code: "ENOENT" });
});
test("a fresh Node process reopens the persistent original using only its saved logical key", async () => {
  const prepared = await prepare(); await writePreparedUpload(prepared);
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env, NODE_ENV: "test", NODE_OPTIONS: "", DATABASE_URL: UNIT_DATABASE_URL,
    MEDIA_STORAGE_ROOT: process.env.MEDIA_STORAGE_ROOT,
    TSX_TSCONFIG_PATH: path.join(originalCwd, "tsconfig.json"),
  };
  delete childEnv.TEST_DATABASE_URL;
  const script = `
    const { readUploadByStoragePath, statUploadByStoragePath } = require(${JSON.stringify(path.join(originalCwd, "lib", "media-storage.ts"))});
    Promise.all([readUploadByStoragePath(process.argv[1]), statUploadByStoragePath(process.argv[1])])
      .then(([bytes, metadata]) => process.stdout.write(JSON.stringify({ base64: bytes.toString("base64"), size: metadata.size })))
      .catch(() => { process.stderr.write("Fixture read failed."); process.exitCode = 1; });
  `;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--eval", script, prepared.storagePath], {
    cwd: originalCwd, env: childEnv, encoding: "utf8", shell: false, windowsHide: true, timeout: 10000, maxBuffer: 64 * 1024,
  });
  assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { base64: Buffer.from(png).toString("base64"), size: png.length });
  await deleteUploadByStoragePath(prepared.storagePath);
});
