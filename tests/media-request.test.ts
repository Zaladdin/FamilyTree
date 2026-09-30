import test from "node:test";
import assert from "node:assert/strict";
import { readMediaFormData } from "@/lib/media-request";
import { HttpError } from "@/lib/http-error";

const origin = "http://localhost/upload";
const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "photo.png");
function request(form: FormData) { return new Request(origin, { method: "POST", body: form }); }
test("media multipart accepts exactly one file and type", async () => {
  const form = new FormData(); form.set("type", "photo"); form.set("file", png);
  const result = await readMediaFormData(request(form));
  assert.equal(result.type, "photo"); assert.equal(result.file.name, "photo.png");
});
test("media multipart rejects duplicate and unknown fields", async () => {
  for (const field of ["type", "file", "unknown"]) {
    const form = new FormData(); form.set("type", "photo"); form.set("file", png); form.append(field, field === "file" ? png : "photo");
    await assert.rejects(readMediaFormData(request(form)), (error: unknown) => error instanceof HttpError && error.status === 400);
  }
});
test("media request counts actual bytes and cancels oversized streams with absent or false length", async () => {
  for (const declared of [undefined, "1", "invalid"]) {
    let sent = 0; let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { sent += 1; controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
    const headers: Record<string, string> = { "content-type": "multipart/form-data; boundary=test" };
    if (declared) headers["content-length"] = declared;
    const input = new Request(origin, { method: "POST", headers, body, duplex: "half" } as RequestInit);
    await assert.rejects(readMediaFormData(input), (error: unknown) => error instanceof HttpError && error.status === 413);
    assert.equal(cancelled, true); assert.ok(sent <= 23);
  }
});
test("media multipart total cap covers ignored multipart parts and preflight large declared lengths", async () => {
  const form = new FormData(); form.set("type", "photo"); form.set("file", png); form.set("padding", new Blob([new Uint8Array(21 * 1024 * 1024)]));
  await assert.rejects(readMediaFormData(request(form)), (error: unknown) => error instanceof HttpError && error.status === 413);
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const input = new Request(origin, { method: "POST", headers: { "content-length": String(22 * 1024 * 1024) }, body, duplex: "half" } as RequestInit);
  await assert.rejects(readMediaFormData(input), (error: unknown) => error instanceof HttpError && error.status === 413);
  assert.equal(cancelled, true);
});
test("media multipart rejects malformed body and unsupported content type safely", async () => {
  for (const contentType of ["application/json", "multipart/form-data; boundary=missing"]) {
    await assert.rejects(readMediaFormData(new Request(origin, { method: "POST", headers: { "content-type": contentType }, body: "private malformed data" })),
      (error: unknown) => error instanceof HttpError && error.status === 400 && !error.message.includes("private"));
  }
});
