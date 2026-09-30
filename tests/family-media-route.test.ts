import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";
import { HttpError } from "@/lib/http-error";

const previousUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = UNIT_DATABASE_URL;
const globalPrisma = globalThis as { prisma?: unknown };
const previousPrisma = globalPrisma.prisma;
const unexpected = async (..._args: unknown[]): Promise<unknown> => { throw new Error("Unexpected dependency call"); };
const prisma = { session: { findUnique: unexpected }, familyMembership: { findFirst: unexpected } };
globalPrisma.prisma = prisma;
const requireTest = createRequire(path.resolve("tests/family-media-route.test.ts"));
const repositoryId = requireTest.resolve("../lib/family-media-repository");
const originalRepository = requireTest(repositoryId);
const repository = { uploadMediaAssetForPerson: unexpected, deleteMediaAssetFromPerson: unexpected, getMediaAssetForFamily: unexpected };
requireTest.cache[repositoryId]!.exports = repository;
const responseId = requireTest.resolve("../lib/media-response");
const originalResponse = requireTest(responseId);
const streamResponse = { buildMediaResponse: unexpected };
requireTest.cache[responseId]!.exports = streamResponse;
const headers: typeof import("next/headers") = requireTest("next/headers");
const { POST }: typeof import("../app/api/family/[slug]/people/[personId]/media/route") = requireTest("../app/api/family/[slug]/people/[personId]/media/route");
const { GET, DELETE }: typeof import("../app/api/family/[slug]/people/[personId]/media/[assetId]/route") = requireTest("../app/api/family/[slug]/people/[personId]/media/[assetId]/route");
after(() => {
  if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  if (previousPrisma === undefined) delete globalPrisma.prisma; else globalPrisma.prisma = previousPrisma;
  requireTest.cache[repositoryId]!.exports = originalRepository;
  requireTest.cache[responseId]!.exports = originalResponse;
});
const origin = "http://localhost:3000";
const context = (assetId = "asset", personId = "person", slug = "family") => ({ params: Promise.resolve({ slug, personId, assetId }) });
function setup(t: TestContext, options: { role?: string | null; anonymous?: boolean; queued?: boolean; domainError?: Error } = {}) {
  t.mock.method(headers, "cookies", async () => ({ get: () => options.anonymous ? undefined : { value: "synthetic-cookie" } }));
  t.mock.method(prisma.session, "findUnique", async () => ({ expiresAt: new Date(Date.now() + 60_000), user: { id: "actor", firstName: "Тест", lastName: "Редактор" } }));
  t.mock.method(prisma.familyMembership, "findFirst", async () => options.role === null ? null : { role: options.role ?? "editor" });
  const calls: string[] = [];
  t.mock.method(repository, "uploadMediaAssetForPerson", async (params: { actorUserId: string; personId: string; file: File }) => {
    assert.equal(params.actorUserId, "actor"); assert.equal(params.personId, "person"); assert.ok(params.file instanceof File);
    calls.push("upload"); if (options.domainError) throw options.domainError;
    return { id: "asset", type: "photo", title: "Снимок", url: "/private-media" };
  });
  t.mock.method(repository, "deleteMediaAssetFromPerson", async (params: { actorUserId: string }) => {
    assert.equal(params.actorUserId, "actor"); calls.push("delete");
    if (options.domainError) throw options.domainError;
    return { type: "photo", cleanupPending: options.queued ?? false };
  });
  t.mock.method(repository, "getMediaAssetForFamily", async (params: { slug: string; personId: string; assetId: string }) => {
    calls.push("read"); if (options.domainError) throw options.domainError;
    if (params.slug !== "family" || params.personId !== "person" || params.assetId !== "asset") throw new HttpError(404, "Медиафайл не найден.");
    return { storagePath: "synthetic", mimeType: "audio/mpeg", title: "Звук" };
  });
  t.mock.method(streamResponse, "buildMediaResponse", async (request: Request) => {
    calls.push("stream"); assert.equal(request.headers.get("range"), "bytes=1-2");
    return new Response(new Uint8Array([1, 2]), { status: 206, headers: { "cache-control": "private, no-store", "content-range": "bytes 1-2/4" } });
  });
  return calls;
}
function uploadRequest(extraFile = false) {
  const form = new FormData(); form.set("type", "photo");
  form.set("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "photo.png", { type: "image/png" }));
  if (extraFile) form.append("file", new File(["extra"], "extra.png"));
  return new Request(origin, { method: "POST", headers: { origin }, body: form });
}

test("media POST bounds actual request bytes before parsing or repository access without Content-Length", async (t) => {
  const calls = setup(t);
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
  const request = new Request(origin, { method: "POST", headers: { origin, "content-type": "multipart/form-data; boundary=test" }, body, duplex: "half" } as RequestInit);
  assert.equal(request.headers.has("content-length"), false);
  assert.equal((await POST(request, context())).status, 413);
  assert.equal(cancelled, true); assert.deepEqual(calls, []);
});

test("media POST rejects duplicate file parts before creating a reservation", async (t) => {
  const calls = setup(t);
  assert.equal((await POST(uploadRequest(true), context())).status, 400);
  assert.deepEqual(calls, []);
});

test("media POST carries authenticated actor identity into the lifecycle repository", async (t) => {
  const calls = setup(t);
  const response = await POST(uploadRequest(), context());
  assert.equal(response.status, 200); assert.equal((await response.json()).asset.id, "asset"); assert.deepEqual(calls, ["upload"]);
});

test("media DELETE distinguishes completed and durably queued physical cleanup", async (t) => {
  const options = { queued: true };
  setup(t, options);
  const request = () => new Request(origin, { method: "DELETE", headers: { origin } });
  const queued = await DELETE(request(), context());
  assert.equal(queued.status, 202); assert.match((await queued.json()).message, /очередь/);
  options.queued = false;
  assert.equal((await DELETE(request(), context())).status, 200);
});

for (const [method, handler] of [["POST", POST], ["DELETE", DELETE]] as const) {
  test(`media ${method} rejects cross-origin and read-only writes before body or storage work`, async (t) => {
    const calls = setup(t, { role: "member" });
    const foreign = new Request(origin, { method, headers: { origin: "https://foreign.invalid" } });
    assert.equal((await handler(foreign, context())).status, 403);
    const request = method === "POST" ? uploadRequest() : new Request(origin, { method, headers: { origin } });
    assert.equal((await handler(request, context())).status, 403); assert.equal(request.bodyUsed, false); assert.deepEqual(calls, []);
  });
}

test("media GET checks access before streaming and preserves the authenticated Range response", async (t) => {
  const options: { role: string | null } = { role: "guest" };
  const calls = setup(t, options);
  const request = () => new Request(origin, { headers: { range: "bytes=1-2" } });
  const response = await GET(request(), context());
  assert.equal(response.status, 206); assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2]);
  assert.deepEqual(calls, ["read", "stream"]);
  options.role = null; calls.length = 0;
  assert.equal((await GET(request(), context())).status, 403); assert.deepEqual(calls, []);
});

test("media GET never opens an asset returned as foreign or missing by the scoped repository", async (t) => {
  const calls = setup(t);
  for (const foreign of [context("foreign-asset"), context("asset", "foreign-person"), context("asset", "person", "foreign-family")]) {
    assert.equal((await GET(new Request(origin), foreign)).status, 404);
  }
  assert.equal(calls.includes("stream"), false);
});

test("media routes preserve quota errors and hide unknown infrastructure failures", async (t) => {
  const options = { domainError: new HttpError(413, "Квота исчерпана.") as Error };
  setup(t, options);
  assert.equal((await POST(uploadRequest(), context())).status, 413);
  options.domainError = new Error("private-path password secret");
  const response = await POST(uploadRequest(), context());
  assert.equal(response.status, 500); assert.doesNotMatch(JSON.stringify(await response.json()), /private-path|password|secret/);
});
