import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";

const environment = new Map(["DATABASE_URL", "REDIS_URL", "TRUST_PROXY_HEADERS"].map((key) => [key, process.env[key]]));
process.env.DATABASE_URL = UNIT_DATABASE_URL;
delete process.env.REDIS_URL; process.env.TRUST_PROXY_HEADERS = "false";
const shared = globalThis as { prisma?: unknown }; const previous = shared.prisma;
const unexpected = async (): Promise<never> => { throw new Error("Unexpected private database access"); };
const prisma = { user: { findUnique: unexpected }, session: { findUnique: unexpected }, authToken: { updateMany: unexpected }, $transaction: unexpected };
shared.prisma = prisma;
after(() => {
  for (const [key, value] of environment) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  if (previous === undefined) delete shared.prisma; else shared.prisma = previous;
});
const requireTest = createRequire(path.resolve("tests/auth-account-route.test.ts"));
const headers: typeof import("next/headers") = requireTest("next/headers");
const { hashPassword }: typeof import("../lib/auth") = requireTest("../lib/auth");
const { POST: forgot }: typeof import("../app/api/auth/forgot-password/route") = requireTest("../app/api/auth/forgot-password/route");
const { POST: reset }: typeof import("../app/api/auth/reset-password/route") = requireTest("../app/api/auth/reset-password/route");
const { POST: verifyRequest }: typeof import("../app/api/auth/verify-email/request/route") = requireTest("../app/api/auth/verify-email/request/route");
const { POST: verifyConfirm }: typeof import("../app/api/auth/verify-email/confirm/route") = requireTest("../app/api/auth/verify-email/confirm/route");
const { POST: change }: typeof import("../app/api/auth/change-password/route") = requireTest("../app/api/auth/change-password/route");
const { POST: revoke }: typeof import("../app/api/auth/sessions/revoke-others/route") = requireTest("../app/api/auth/sessions/revoke-others/route");
const routes = [forgot, reset, verifyRequest, verifyConfirm, change, revoke];
const origin = "http://localhost:3000";
const password = "unit-route-password";
const token = "c".repeat(64);
function request(payload: unknown = {}, source = origin) {
  return new Request(`${origin}/api/auth/action`, { method: "POST", headers: { origin: source, "content-type": "application/json" }, body: JSON.stringify(payload) });
}
async function setup(t: TestContext, loggedIn = true) {
  const user = { id: `user-${t.name}`, firstName: "Тест", lastName: "Аккаунт", email: "route@example.invalid", emailVerifiedAt: null, legacyAccount: false, sessionVersion: 0, passwordHash: await hashPassword(password) };
  const cookieWrites: unknown[] = [];
  t.mock.method(headers, "cookies", async () => ({ get: () => loggedIn ? { value: "unit-session-cookie" } : undefined, set: (...args: unknown[]) => { cookieWrites.push(args); } }));
  t.mock.method(prisma.session, "findUnique", async () => ({ id: "current", userId: user.id, user, expiresAt: new Date(Date.now() + 60_000), sessionVersion: 0 }));
  t.mock.method(prisma.user, "findUnique", async () => user);
  return { user, cookieWrites };
}

test("all account mutations reject foreign origins before reading the body", async () => {
  for (const handler of routes) {
    const input = request({}, "https://outside.invalid");
    const response = await handler(input);
    assert.equal(response.status, 403); assert.equal(input.bodyUsed, false);
  }
});

test("protected account endpoints reject anonymous callers before reading their body", async (t) => {
  await setup(t, false);
  for (const handler of [verifyRequest, verifyConfirm, change, revoke]) {
    const input = request({}); const response = await handler(input);
    assert.equal(response.status, 401); assert.equal(input.bodyUsed, false);
  }
});

test("forgot-password returns the same safe response for unknown, legacy, delivery-disabled and storage-failed accounts", async (t) => {
  const { user } = await setup(t);
  const responses: string[] = [];
  let transactionCalls = 0;
  t.mock.method(prisma, "$transaction", async (operation: (tx: unknown) => Promise<unknown>) => {
    transactionCalls += 1;
    return operation({ user: { findUnique: async () => user }, authToken: { updateMany: async () => ({ count: 0 }), create: async () => ({ id: "issued" }) } });
  });
  t.mock.method(prisma.authToken, "updateMany", async () => ({ count: 1 }));
  for (const mode of ["unknown", "legacy", "disabled", "failure"]) {
    t.mock.method(prisma.user, "findUnique", async () => {
      if (mode === "failure") throw new Error("private SQL or provider details");
      if (mode === "unknown") return null;
      return { ...user, legacyAccount: mode === "legacy" };
    });
    const response = await forgot(request({ email: `${mode}@example.invalid` }));
    assert.equal(response.status, 202); assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    responses.push(await response.text());
  }
  assert.ok(responses.every((value) => value === responses[0]));
  assert.doesNotMatch(responses[0], /private|token|issued/); assert.equal(transactionCalls, 1);
});

test("forgot-password rate limits the normalized target without disclosing account existence", async (t) => {
  await setup(t); t.mock.method(prisma.user, "findUnique", async () => null);
  for (let count = 0; count < 5; count += 1) assert.equal((await forgot(request({ email: "LIMIT@example.invalid" }))).status, 202);
  assert.equal((await forgot(request({ email: " limit@example.invalid " }))).status, 429);
});

test("verification request truthfully reports disabled delivery and exposes no token", async (t) => {
  const { user } = await setup(t);
  t.mock.method(prisma, "$transaction", async (operation: (tx: unknown) => Promise<unknown>) => operation({
    user: { findUnique: async () => user }, authToken: { updateMany: async () => ({ count: 0 }), create: async () => ({ id: "issued" }) },
  }));
  t.mock.method(prisma.authToken, "updateMany", async () => ({ count: 1 }));
  const response = await verifyRequest(request({ currentPassword: password }));
  assert.equal(response.status, 202);
  const body = await response.json(); assert.equal(body.delivered, false); assert.match(body.message, /недоступна/);
  assert.equal("token" in body, false);
});

test("reset and change clear the existing cookie only after successful credential rotation", async (t) => {
  const { user, cookieWrites } = await setup(t);
  t.mock.method(prisma, "$transaction", async (operation: (tx: unknown) => Promise<unknown>) => operation({
    user: { findUnique: async () => user, updateMany: async () => ({ count: 1 }) },
    authToken: { findUnique: async () => ({ id: "token", userId: user.id, email: user.email, sessionVersion: 0, user, purpose: "password_reset", consumedAt: null, expiresAt: new Date(Date.now() + 60_000) }), updateMany: async () => ({ count: 1 }) },
    session: { deleteMany: async () => ({ count: 2 }) },
  }));
  assert.equal((await reset(request({ token, password, passwordConfirmation: password }))).status, 200);
  assert.equal(cookieWrites.length, 1);
  assert.equal((await change(request({ currentPassword: password, password, passwordConfirmation: password }))).status, 200);
  assert.equal(cookieWrites.length, 2);
});

test("invalid JSON, token syntax and confirmation errors never clear a cookie", async (t) => {
  const { cookieWrites } = await setup(t);
  for (const payload of [null, [], { token: "wrong", password, passwordConfirmation: password }, { token, password, passwordConfirmation: "different" }]) {
    assert.equal((await reset(request(payload))).status, 400);
  }
  const invalidJson = new Request(`${origin}/api/auth/reset-password`, { method: "POST", headers: { origin }, body: "{" });
  assert.equal((await reset(invalidJson)).status, 400); assert.equal(cookieWrites.length, 0);
});

test("internal errors in protected auth actions stay private", async (t) => {
  await setup(t);
  t.mock.method(prisma, "$transaction", async () => { throw new Error("private SQL token secret"); });
  const response = await verifyConfirm(request({ token }));
  assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /private|SQL|secret/);
});
