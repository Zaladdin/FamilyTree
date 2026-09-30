import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { prepareUpload, writePreparedUpload, deleteUploadByStoragePath } from "@/lib/media-storage";
import { buildMediaResponse } from "@/lib/media-response";

let root: string; let parent: string; let asset: Awaited<ReturnType<typeof prepareUpload>>;
const previousRoot = process.env.MEDIA_STORAGE_ROOT;
const filesystem: typeof import("node:fs/promises") = createRequire(path.resolve("tests/media-response.test.ts"))("node:fs/promises");
const bytes = new Uint8Array([0x49, 0x44, 0x33, ...Array.from({ length: 100 }, (_, i) => i)]);
before(async () => {
  parent = await realpath(tmpdir()); root = await mkdtemp(path.join(parent, "rodovo-media-response-")); process.env.MEDIA_STORAGE_ROOT = root;
  asset = await prepareUpload({ familySlug: "test", personId: "person", type: "audio", file: new File([bytes], "Голос.mp3") }); await writePreparedUpload(asset);
});
after(async () => {
  if (previousRoot === undefined) delete process.env.MEDIA_STORAGE_ROOT; else process.env.MEDIA_STORAGE_ROOT = previousRoot;
  const target = await realpath(root); assert.equal(path.dirname(target), parent); assert.match(path.basename(target), /^rodovo-media-response-/); await rm(target, { recursive: true, force: true });
});
const request = (range?: string) => new Request("http://localhost/media", { headers: range ? { range } : {} });
test("media response streams original with actual file size and private no-store", async () => {
  const response = await buildMediaResponse(request(), { ...asset, size: 1 });
  assert.equal(response.status, 200); assert.equal(response.headers.get("content-length"), String(bytes.length));
  assert.equal(response.headers.get("accept-ranges"), "bytes"); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});
test("media response handles single closed, open and suffix ranges", async () => {
  for (const [range, start, end] of [["bytes=3-8", 3, 8], ["bytes=99-", 99, 102], ["bytes=-4", 99, 102], ["bytes=100-999", 100, 102], ["bytes=-999", 0, 102]] as const) {
    const response = await buildMediaResponse(request(range), asset); assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), `bytes ${start}-${end}/${bytes.length}`);
    assert.equal(response.headers.get("content-length"), String(end - start + 1));
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes.slice(start, end + 1));
  }
});
test("media response rejects malformed, unsatisfiable and multiple ranges with 416", async () => {
  for (const range of ["bytes=103-", "bytes=9-1", "bytes=-0", "bytes=", "bytes=0-1,5-6", "bytes=9007199254740993-", "items=0-1"]) {
    const response = await buildMediaResponse(request(range), asset); assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), `bytes */${bytes.length}`); assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
});
test("cancelling media response closes its file handle so the known asset can be deleted", async (t) => {
  const temporary = await prepareUpload({ familySlug: "test", personId: "person", type: "audio", file: new File([bytes, new Uint8Array(256 * 1024)], "cancel.mp3") }); await writePreparedUpload(temporary);
  const realOpen = filesystem.open; let closeCount = 0;
  t.mock.method(filesystem, "open", async (...args: Parameters<typeof filesystem.open>) => {
    const handle = await realOpen(...args); const realClose = handle.close.bind(handle);
    t.mock.method(handle, "close", async () => { await realClose(); closeCount += 1; }); return handle;
  });
  const response = await buildMediaResponse(request(), temporary); const reader = response.body!.getReader();
  const first = await reader.read(); assert.equal(first.value!.length, 64 * 1024); assert.equal(closeCount, 0);
  await reader.cancel(); assert.equal(closeCount, 1); await deleteUploadByStoragePath(temporary.storagePath);
  await assert.rejects(buildMediaResponse(request(), temporary), { code: "ENOENT" });
});
test("If-Range serves a range only for the current strong checksum validator", async () => {
  for (const [ifRange, status] of [[`"${asset.checksum}"`, 206], ['"outdated"', 200], [`W/"${asset.checksum}"`, 200], ["Wed, 21 Oct 2015 07:28:00 GMT", 200]] as const) {
    const response = await buildMediaResponse(new Request("http://localhost/media", { headers: { range: "bytes=0-2", "if-range": ifRange } }), asset);
    assert.equal(response.status, status); assert.equal(response.headers.get("etag"), `"${asset.checksum}"`);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), status === 206 ? bytes.slice(0, 3) : bytes);
  }
});
test("a Unicode title at the filename length boundary remains a valid downloadable original", async () => {
  const title = `${"a".repeat(239)}😀.mp3`;
  const prepared = await prepareUpload({ familySlug: "test", personId: "person", type: "audio", file: new File([bytes], title) });
  await writePreparedUpload(prepared);
  const response = await buildMediaResponse(request(), prepared);
  assert.match(response.headers.get("content-disposition")!, /%F0%9F%98%80/);
  await response.body!.cancel(); await deleteUploadByStoragePath(prepared.storagePath);
});
test("HEAD returns full representation headers without reading bytes and closes the file before responding", async (t) => {
  const temporary = await prepareUpload({ familySlug: "test", personId: "person", type: "audio", file: new File([bytes, new Uint8Array(256 * 1024)], "head.mp3") });
  await writePreparedUpload(temporary);
  const realOpen = filesystem.open; let reads = 0; let closes = 0;
  t.mock.method(filesystem, "open", async (...args: Parameters<typeof filesystem.open>) => {
    const handle = await realOpen(...args); const realClose = handle.close.bind(handle);
    t.mock.method(handle, "read", async () => { reads += 1; throw new Error("HEAD must never read file content"); });
    t.mock.method(handle, "close", async () => { await realClose(); closes += 1; }); return handle;
  });
  for (const range of [undefined, "bytes=0-2", "bytes=9999999-"]) {
    const response = await buildMediaResponse(new Request("http://localhost/media", { method: "HEAD", headers: range ? { range } : {} }), temporary);
    try {
      assert.equal(response.body, null); assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-length"), String(temporary.size)); assert.equal(response.headers.get("content-range"), null);
      assert.equal(response.headers.get("etag"), `"${temporary.checksum}"`); assert.equal(response.headers.get("cache-control"), "private, no-store");
    } finally { await response.body?.cancel().catch(() => undefined); }
  }
  assert.equal(reads, 0); assert.equal(closes, 3);
  await deleteUploadByStoragePath(temporary.storagePath);
});
test("an already aborted media request does not open a file", async (t) => {
  const controller = new AbortController(); controller.abort();
  const opened = t.mock.method(filesystem, "open", async () => { throw new Error("An aborted request must not open a file"); });
  await assert.rejects(buildMediaResponse(new Request("http://localhost/media", { signal: controller.signal }), asset), { name: "AbortError" });
  assert.equal(opened.mock.callCount(), 0);
});
test("aborting while the original is opening closes the descriptor before throwing", async (t) => {
  const controller = new AbortController(); const realOpen = filesystem.open; let closes = 0;
  t.mock.method(filesystem, "open", async (...args: Parameters<typeof filesystem.open>) => {
    const handle = await realOpen(...args); const realClose = handle.close.bind(handle);
    t.mock.method(handle, "close", async () => { await realClose(); closes += 1; }); controller.abort(); return handle;
  });
  let response: Response | undefined;
  try {
    await assert.rejects(async () => { response = await buildMediaResponse(new Request("http://localhost/media", { signal: controller.signal }), asset); }, { name: "AbortError" });
    assert.equal(closes, 1);
  } finally { await response?.body?.cancel().catch(() => undefined); }
});
test("a disconnected client closes an unread response without requiring body cancellation", async (t) => {
  const temporary = await prepareUpload({ familySlug: "test", personId: "person", type: "audio", file: new File([bytes, new Uint8Array(256 * 1024)], "abort.mp3") });
  await writePreparedUpload(temporary);
  const controller = new AbortController(); const realOpen = filesystem.open; let closes = 0;
  let closed!: () => void; const didClose = new Promise<void>((resolve) => { closed = resolve; });
  t.mock.method(filesystem, "open", async (...args: Parameters<typeof filesystem.open>) => {
    const handle = await realOpen(...args); const realClose = handle.close.bind(handle);
    t.mock.method(handle, "close", async () => { await realClose(); closes += 1; closed(); }); return handle;
  });
  const response = await buildMediaResponse(new Request("http://localhost/media", { signal: controller.signal }), temporary);
  controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([didClose, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Disconnected response kept its file open")), 1000); })]);
    assert.equal(closes, 1); await assert.rejects(response.arrayBuffer(), { name: "AbortError" });
  } finally { clearTimeout(timer); await response.body?.cancel().catch(() => undefined); }
  await deleteUploadByStoragePath(temporary.storagePath);
});
