import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";
import { HttpError } from "@/lib/http-error";
import { assertUploadSizeWithinLimit, detectMimeTypeForUpload } from "@/lib/media-storage";

const previousUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = UNIT_DATABASE_URL;
const globalPrisma = globalThis as { prisma?: unknown };
const previousPrisma = globalPrisma.prisma;
const unexpected = async () => { throw new Error("private database host, SQL and family data"); };
const prisma = { session: { findUnique: unexpected }, familyMembership: { findFirst: unexpected }, family: { findUnique: unexpected }, mediaAsset: { findFirst: unexpected }, $transaction: unexpected };
globalPrisma.prisma = prisma;
after(() => {
  if (previousPrisma === undefined) delete globalPrisma.prisma;
  else globalPrisma.prisma = previousPrisma;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
});
const requireTest = createRequire(path.resolve("tests/family-api-errors.test.ts"));
const headers: typeof import("next/headers") = requireTest("next/headers");
assert.equal(requireTest("../lib/prisma").prisma, prisma);
const origin = "http://localhost:3000";
const routes = [
  ["families", "POST"],
  ["family/[slug]/members", "GET"],
  ["family/[slug]/members", "POST"],
  ["family/[slug]/members/[membershipId]", "PATCH"],
  ["family/[slug]/members/[membershipId]", "DELETE"],
  ["family/[slug]/people/[personId]", "PATCH"],
  ["family/[slug]/people/[personId]/stories", "POST"],
  ["family/[slug]/people/[personId]/archive", "POST"],
  ["family/[slug]/people/[personId]/restore", "POST"],
  ["family/[slug]/people/[personId]/media", "POST"],
  ["family/[slug]/people/[personId]/media/[assetId]", "GET"],
  ["family/[slug]/people/[personId]/media/[assetId]", "DELETE"],
] as const;
const context = () => ({ params: Promise.resolve({ slug: "unit", personId: "unit", membershipId: "unit", assetId: "unit" }) });

for (const [route, method] of routes) {
  test(`${method} ${route} hides unexpected infrastructure errors with 500`, async (t) => {
    t.mock.method(headers, "cookies", async () => ({ get: () => ({ value: "unit-session" }) }));
    const handler = requireTest(`../app/api/${route}/route`)[method];
    const response = await handler(new Request(`${origin}/api/${route}`, { method, headers: { origin } }), context());
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.deepEqual(Object.keys(body), ["error"]);
    assert.doesNotMatch(body.error, /private|SQL|host/);
  });

  test(`${method} ${route} preserves unauthenticated 401`, async (t) => {
    t.mock.method(headers, "cookies", async () => ({ get: () => undefined }));
    const handler = requireTest(`../app/api/${route}/route`)[method];
    const response = await handler(new Request(`${origin}/api/${route}`, { method, headers: { origin } }), context());
    assert.equal(response.status, 401);
  });
}

for (const [route, method] of routes.filter(([route, method]) => method !== "GET" && method !== "DELETE" && !/archive|restore|media/.test(route))) {
  test(`${method} ${route} rejects malformed JSON with safe 400`, async (t) => {
    t.mock.method(headers, "cookies", async () => ({ get: () => ({ value: "unit-session" }) }));
    t.mock.method(prisma.session, "findUnique", async () => ({ expiresAt: new Date(Date.now() + 60_000), user: { id: "unit", firstName: "Тест", lastName: "Тест" } }));
    t.mock.method(prisma.familyMembership, "findFirst", async () => ({ role: "owner" }));
    const handler = requireTest(`../app/api/${route}/route`)[method];
    const response = await handler(new Request(`${origin}/api/${route}`, { method, headers: { origin }, body: '{"private-family-fragment"' }), context());
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Некорректные данные запроса." });
  });
}

test("missing family remains a deliberate 404 when updating a person", async (t) => {
  t.mock.method(prisma.family, "findUnique", async () => null);
  t.mock.method(prisma, "$transaction", async (run: (transaction: typeof prisma) => Promise<unknown>) => run(prisma));
  const { updatePersonInFamily } = requireTest("../lib/family-repository");
  const { HttpError } = requireTest("../lib/http-error");
  await assert.rejects(updatePersonInFamily("unit", "unit", {}), (error: unknown) => error instanceof HttpError && (error as { status: number }).status === 404);
});

test("upload validation preserves deliberate client error status", () => {
  assert.throws(() => assertUploadSizeWithinLimit(0, "photo"), (error: unknown) => error instanceof HttpError && error.status === 400);
  assert.throws(() => assertUploadSizeWithinLimit(11 * 1024 * 1024, "photo"), (error: unknown) => error instanceof HttpError && error.status === 413);
  assert.throws(() => detectMimeTypeForUpload(new Uint8Array([0]), "photo"), (error: unknown) => error instanceof HttpError && error.status === 400);
});

test("media download hides storage errors after authorization and lookup", async (t) => {
  t.mock.method(headers, "cookies", async () => ({ get: () => ({ value: "unit-session" }) }));
  t.mock.method(prisma.session, "findUnique", async () => ({ expiresAt: new Date(Date.now() + 60_000), user: { id: "unit" } }));
  t.mock.method(prisma.familyMembership, "findFirst", async () => ({ role: "owner" }));
  t.mock.method(prisma.mediaAsset, "findFirst", async () => ({ storagePath: "storage/__unit_nonexistent__/private-family.jpg" }));
  const { GET } = requireTest("../app/api/family/[slug]/people/[personId]/media/[assetId]/route");
  const response = await GET(new Request(origin), context());
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Не удалось открыть медиафайл." });
});

test("member listing hides Prisma diagnostics after authorization", async (t) => {
  t.mock.method(headers, "cookies", async () => ({ get: () => ({ value: "unit-session" }) }));
  t.mock.method(prisma.session, "findUnique", async () => ({ expiresAt: new Date(Date.now() + 60_000), user: { id: "unit" } }));
  t.mock.method(prisma.familyMembership, "findFirst", async () => ({ role: "owner" }));
  t.mock.method(prisma.family, "findUnique", async () => { throw new Prisma.PrismaClientKnownRequestError("private SQL credentials", { code: "P2010", clientVersion: "unit" }); });
  const { GET } = requireTest("../app/api/family/[slug]/members/route");
  const response = await GET(new Request(origin), context());
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Не удалось загрузить список участников." });
});
