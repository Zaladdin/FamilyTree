import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";

const previousUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = UNIT_DATABASE_URL;
const globalPrisma = globalThis as { prisma?: unknown };
const previousPrisma = globalPrisma.prisma;
const unexpected = async (..._args: unknown[]): Promise<unknown> => { throw new Error("Unexpected database access"); };
const prisma = { session: { findUnique: unexpected }, familyMembership: { findFirst: unexpected }, $transaction: unexpected };
globalPrisma.prisma = prisma;
const requireTest = createRequire(path.resolve("tests/family-invitation-route.test.ts"));
const headers: typeof import("next/headers") = requireTest("next/headers");
const rate: typeof import("@/lib/family-invitation-rate-limit") = requireTest("../lib/family-invitation-rate-limit");
let testTime = Date.now();
const routes = [
  ["POST", "family/[slug]/members"],
  ["GET", "family/[slug]/invitations"],
  ["PATCH", "family/[slug]/invitations/[invitationId]"],
  ["DELETE", "family/[slug]/invitations/[invitationId]"],
  ["POST", "family/[slug]/invitations/[invitationId]/resend"],
  ["POST", "invitations/accept"],
] as const;
after(() => {
  if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  if (previousPrisma === undefined) delete globalPrisma.prisma; else globalPrisma.prisma = previousPrisma;
});
const context = () => ({ params: Promise.resolve({ slug: "unit", invitationId: "invite" }) });
const payload = { email: "recipient@example.invalid", role: "member", expectedVersion: 0, token: "a".repeat(64) };
function request(method: string, origin = "http://localhost", body = JSON.stringify(payload)) {
  return new Request("http://localhost/api/unit", { method, headers: { Origin: origin, "Content-Type": "application/json" }, ...(method === "GET" ? {} : { body }) });
}
function setup(t: TestContext, loggedIn = true, role = "owner") {
  testTime += 16 * 60 * 1000;
  t.mock.method(Date, "now", () => testTime);
  t.mock.method(headers, "cookies", async () => ({ get: () => loggedIn ? { value: "synthetic-session" } : undefined }));
  t.mock.method(prisma.session, "findUnique", async () => ({ expiresAt: new Date(Date.now() + 60_000), user: { id: "owner", email: "owner@example.invalid", firstName: "Тест", lastName: "Владелец" } }));
  t.mock.method(prisma.familyMembership, "findFirst", async () => ({ role }));
}
for (const [method, pathPart] of routes) {
  const route = requireTest(`../app/api/${pathPart}/route`)[method] as (request: Request, routeContext: ReturnType<typeof context>) => Promise<Response>;
  test(`${method} ${pathPart} requires an authenticated session`, async (t) => {
    setup(t, false);
    assert.equal((await route(request(method), context())).status, 401);
  });
  if (method !== "GET") {
    test(`${method} ${pathPart} rejects cross-origin writes before accessing auth/database`, async () => {
      assert.equal((await route(request(method, "https://other.invalid"), context())).status, 403);
    });
    test(`${method} ${pathPart} rejects malformed JSON without details`, async (t) => {
      setup(t);
      assert.equal((await route(request(method, "http://localhost", "{"), context())).status, 400);
    });
  }
  if (pathPart !== "invitations/accept") {
    test(`${method} ${pathPart} rejects non-manager role`, async (t) => {
      setup(t, true, "member");
      assert.equal((await route(request(method), context())).status, 403);
    });
  }
  test(`${method} ${pathPart} hides unexpected private infrastructure details`, async (t) => {
    setup(t);
    t.mock.method(prisma, "$transaction", async () => { throw new Error("private database hostname raw-token@example.invalid"); });
    const response = await route(request(method), context());
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /private|hostname|raw-token/);
  });
  if (method !== "GET" && method !== "DELETE") {
    test(`${method} ${pathPart} enforces rate limits before repository access`, async (t) => {
      setup(t);
      let response: Response | undefined;
      for (let attempt = 0; attempt <= 60; attempt += 1) {
        response = await route(request(method), context());
        if (response.status === 429) break;
      }
      assert.equal(response?.status, 429);
    });
  }
}
test("invitation rate-limit keys never contain recipient address or bearer token", async () => {
  const keys: string[] = [];
  const capture = async ({ key }: { key: string }) => { keys.push(key); };
  await rate.enforceInvitationRateLimit(request("POST"), "owner", "unit:recipient@example.invalid", capture);
  await rate.enforceInvitationRateLimit(request("POST"), "owner", undefined, capture);
  assert.equal(keys.length, 5);
  assert.doesNotMatch(keys.join(" "), /recipient@example|aaaaaaaa/);
  assert.ok(keys.includes("invitation:accept:global"));
});
