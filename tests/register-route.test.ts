import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { NextRequest } from "next/server";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";

// Node's test runner isolates this file in a child process. Keep direct runs
// safe too: configure the closed unit port before loading Prisma, and never
// connect to an inherited Redis service or depend on Next's build-time flag.
const envKeys = ["DATABASE_URL", "REDIS_URL", "TRUST_PROXY_HEADERS", "__NEXT_NO_MIDDLEWARE_URL_NORMALIZE", "NODE_ENV"];
const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
process.env.DATABASE_URL = UNIT_DATABASE_URL;
process.env.TRUST_PROXY_HEADERS = "false";
delete process.env.REDIS_URL;
delete process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE;
after(() => {
  for (const [key, value] of previousEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const requireFromTest = createRequire(path.resolve("tests/register-route.test.ts"));
const nextHeaders: typeof import("next/headers") = requireFromTest("next/headers");
// Prisma delegates are proxies without method descriptors, so seed the existing
// development singleton seam with plain fakes before auth loads it. No real
// PrismaClient is constructed and every unconfigured call fails closed.
async function unexpectedDatabaseCall() {
  throw new Error("Unexpected database operation in registration unit test");
}
const prisma = {
  user: { findUnique: unexpectedDatabaseCall, create: unexpectedDatabaseCall },
  session: { create: unexpectedDatabaseCall, deleteMany: unexpectedDatabaseCall },
};
const globalForPrisma = globalThis as { prisma?: unknown };
const previousPrisma = globalForPrisma.prisma;
globalForPrisma.prisma = prisma;
after(() => {
  if (previousPrisma === undefined) delete globalForPrisma.prisma;
  else globalForPrisma.prisma = previousPrisma;
});
assert.equal(requireFromTest("../lib/prisma").prisma === prisma, true, "auth must use the isolated Prisma fake");
const { POST }: typeof import("../app/api/auth/register/route") = requireFromTest("../app/api/auth/register/route");
const { verifyPassword, hashSessionToken }: typeof import("../lib/auth") = requireFromTest("../lib/auth");

const origin = "http://127.0.0.1:3000";
const form = {
  firstName: "  Тест  ",
  lastName: "  Регистрация  ",
  email: "  REGISTRATION@example.test  ",
  password: "  unit-only password  ",
};

type UserData = { firstName: string; lastName: string; email: string; passwordHash: string };
type SessionData = { userId: string; tokenHash: string; expiresAt: Date };
type CookieOptions = { httpOnly: boolean; sameSite: string; secure: boolean; path: string; expires: Date };

function installFakes(t: TestContext, duplicate = false) {
  const userWrites: UserData[] = [];
  const sessionWrites: SessionData[] = [];
  const cookieWrites: { name: string; value: string; options: CookieOptions }[] = [];
  const lookup = t.mock.method(prisma.user, "findUnique", async () => duplicate ? { id: "existing-unit-user" } : null);
  const userCreate = t.mock.method(prisma.user, "create", async ({ data }: { data: UserData }) => {
    userWrites.push(data);
    return { id: "registered-unit-user", ...data, createdAt: new Date(), updatedAt: new Date() };
  });
  const sessionCreate = t.mock.method(prisma.session, "create", async ({ data }: { data: SessionData }) => {
    sessionWrites.push(data);
    return { id: "registered-unit-session", ...data, createdAt: new Date() };
  });
  const sessionDelete = t.mock.method(prisma.session, "deleteMany", async () => ({ count: 0 }));
  const cookieSet = t.mock.fn((name: string, value: string, options: CookieOptions) => {
    cookieWrites.push({ name, value, options });
  });
  const cookies = t.mock.method(nextHeaders, "cookies", async () => ({ set: cookieSet }));

  return { lookup, userCreate, sessionCreate, sessionDelete, cookies, userWrites, sessionWrites, cookieWrites };
}

function registrationRequest(fields: Partial<typeof form> = {}, requestOrigin = origin) {
  return new NextRequest(`${origin}/api/auth/register`, {
    method: "POST",
    headers: { host: "127.0.0.1:3000", origin: requestOrigin },
    body: new URLSearchParams({ ...form, ...fields }),
  });
}

function redirectUrl(response: Response, pathname: string) {
  assert.equal(response.status, 303);
  const location = response.headers.get("location");
  assert.ok(location);
  const url = new URL(location);
  assert.equal(url.origin, origin, "redirects must retain the browser's loopback hostname");
  assert.equal(url.pathname, pathname);
  return url;
}

function assertNoWrites(fakes: ReturnType<typeof installFakes>) {
  assert.equal(fakes.userCreate.mock.callCount(), 0);
  assert.equal(fakes.sessionCreate.mock.callCount(), 0);
  assert.equal(fakes.sessionDelete.mock.callCount(), 0);
  assert.equal(fakes.cookies.mock.callCount(), 0);
}

for (const [name, fields, message] of [
  ["empty first name", { firstName: "  " }, /Поле "Имя" обязательно/],
  ["short password", { password: "short" }, /Пароль должен быть не короче 8 символов/],
  ["malformed email", { email: "not-an-email" }, /Укажите корректный email/],
] as const) {
  test(`registration rejects ${name} before any database access`, async (t) => {
    const fakes = installFakes(t);
    const url = redirectUrl(await POST(registrationRequest(fields)), "/register");
    assert.match(url.searchParams.get("error") ?? "", message);
    assert.equal(fakes.lookup.mock.callCount(), 0);
    assertNoWrites(fakes);
  });
}

test("registration rejects another origin before reading the form and preserves the redirect host", async (t) => {
  const fakes = installFakes(t);
  const request = registrationRequest({}, "https://outside.example");
  const url = redirectUrl(await POST(request), "/register");
  assert.match(url.searchParams.get("error") ?? "", /недопустимый источник/);
  assert.equal(request.bodyUsed, false);
  assert.equal(fakes.lookup.mock.callCount(), 0);
  assertNoWrites(fakes);
});

test("registration rejects an existing email without creating a user or session", async (t) => {
  const fakes = installFakes(t, true);
  const url = redirectUrl(await POST(registrationRequest()), "/register");
  assert.match(url.searchParams.get("error") ?? "", /Аккаунт с таким email уже существует/);
  assert.equal(fakes.lookup.mock.callCount(), 1);
  assertNoWrites(fakes);
});

for (const environment of ["test", "production"] as const) {
  test(`registration creates only mocked records and a protected ${environment} session cookie`, async (t) => {
    const previousNodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: environment });
    t.after(() => {
      if (previousNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
      else Object.assign(process.env, { NODE_ENV: previousNodeEnv });
    });
    const fakes = installFakes(t);
    const startedAt = Date.now();
    const url = redirectUrl(await POST(registrationRequest()), "/account");
    assert.equal(url.search, "");
    assert.equal(fakes.lookup.mock.callCount(), 1);
    assert.equal(fakes.userWrites.length, 1);
    assert.equal(fakes.sessionWrites.length, 1);
    assert.equal(fakes.sessionDelete.mock.callCount(), 1);
    assert.equal(fakes.cookieWrites.length, 1);

    const user = fakes.userWrites[0];
    assert.equal(user.firstName, "Тест");
    assert.equal(user.lastName, "Регистрация");
    assert.equal(user.email, "registration@example.test");
    // Boolean assertions never print password/token material, even on failure.
    assert.ok(user.passwordHash !== form.password, "store a password hash, not plaintext");
    assert.ok(/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(user.passwordHash), "use the salted password format");
    assert.equal(await verifyPassword(form.password, user.passwordHash), true);
    assert.equal(await verifyPassword(form.password.trim(), user.passwordHash), false, "preserve password whitespace");

    const session = fakes.sessionWrites[0];
    const cookie = fakes.cookieWrites[0];
    assert.equal(session.userId, "registered-unit-user");
    assert.ok(/^[a-f0-9]{64}$/.test(cookie.value), "create a random session token");
    assert.ok(session.tokenHash !== cookie.value, "store no raw session token in the database");
    assert.ok(session.tokenHash === hashSessionToken(cookie.value), "the stored hash must match the cookie token");
    const ttl = 14 * 24 * 60 * 60 * 1000;
    assert.ok(session.expiresAt.getTime() >= startedAt + ttl);
    assert.ok(session.expiresAt.getTime() <= Date.now() + ttl);
    assert.equal(cookie.name, "rodovo_session");
    assert.deepEqual(cookie.options, {
      httpOnly: true,
      sameSite: "lax",
      secure: environment === "production",
      path: "/",
      expires: session.expiresAt,
    });
  });
}

test("database outage and unexpected errors never expose internals in auth redirects", async (t) => {
  const { Prisma } = requireFromTest("@prisma/client");
  const { POST: login } = requireFromTest("../app/api/auth/login/route");
  for (const error of [
    new Prisma.PrismaClientInitializationError("private host and connection details", "6.8.2", "P1001"),
    new Error("private host and connection details"),
  ]) {
    const fakes = installFakes(t);
    fakes.lookup.mock.mockImplementation(async () => { throw error; });
    const registration = redirectUrl(await POST(registrationRequest()), "/register");
    const loginResponse = await login(new NextRequest(`${origin}/api/auth/login`, {
      method: "POST", headers: { host: "127.0.0.1:3000", origin },
      body: new URLSearchParams({ email: "outage@example.test", password: "unit-password", redirectTo: "/families" }),
    }));
    const loginRedirect = redirectUrl(loginResponse, "/login");
    for (const url of [registration, loginRedirect]) {
      assert.ok(!url.search.includes("private"), "internal exception must not enter redirect URL");
      if (error instanceof Prisma.PrismaClientInitializationError) assert.match(url.searchParams.get("error")!, /временно недоступна/);
      else assert.match(url.searchParams.get("error")!, /Не удалось/);
    }
    assert.equal(loginRedirect.searchParams.get("redirectTo"), "/families");
    assertNoWrites(fakes);
    t.mock.restoreAll();
  }
});
