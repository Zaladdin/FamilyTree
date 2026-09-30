import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";

const priorUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = UNIT_DATABASE_URL;
const shared = globalThis as { prisma?: unknown };
const priorPrisma = shared.prisma;
const unexpected = async (): Promise<never> => { throw new Error("Unexpected database access"); };
const prisma = { user: { findUnique: unexpected }, authToken: { updateMany: unexpected }, $transaction: unexpected };
shared.prisma = prisma;
after(() => {
  if (priorUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorUrl;
  if (priorPrisma === undefined) delete shared.prisma; else shared.prisma = priorPrisma;
});
const requireTest = createRequire(path.resolve("tests/auth-account.test.ts"));
const account: typeof import("../lib/auth-account") = requireTest("../lib/auth-account");
const mail: typeof import("../lib/auth-mail") = requireTest("../lib/auth-mail");
const { hashPassword, verifyPassword }: typeof import("../lib/auth") = requireTest("../lib/auth");
const { hashAuthToken }: typeof import("../lib/auth-token") = requireTest("../lib/auth-token");
const { HttpError }: typeof import("../lib/http-error") = requireTest("../lib/http-error");

type User = { id: string; email: string; passwordHash: string; sessionVersion: number; emailVerifiedAt: Date | null; legacyAccount: boolean };
type Token = { id: string; tokenHash: string; purpose: string; userId: string; email: string; sessionVersion: number; expiresAt: Date; consumedAt: Date | null };
type Session = { id: string; userId: string; sessionVersion: number; expiresAt: Date };
type State = { users: User[]; tokens: Token[]; sessions: Session[] };
const currentPassword = "current-unit-password";
const newPassword = "  replacement password  ";
const rawToken = "a".repeat(64);

function matches(row: object, where: Record<string, unknown>) {
  const record = row as Record<string, unknown>;
  return Object.entries(where).every(([key, value]) => {
    const actual = record[key];
    if (value && typeof value === "object" && !(value instanceof Date)) {
      const rule = value as { not?: unknown; gt?: Date; in?: unknown[] };
      if ("not" in rule && actual === rule.not) return false;
      if (rule.gt && (!(actual instanceof Date) || !(actual > rule.gt))) return false;
      if (rule.in && !rule.in.includes(actual)) return false;
      return true;
    }
    return actual === value;
  });
}

async function setup(t: TestContext, options: { verified?: boolean; legacy?: boolean; missing?: boolean; delivered?: boolean; failDelivery?: boolean; casMiss?: boolean; transactionFails?: boolean } = {}) {
  const user: User = { id: "user", email: "person@example.invalid", passwordHash: await hashPassword(currentPassword), sessionVersion: 0, emailVerifiedAt: options.verified === false ? null : new Date(1), legacyAccount: options.legacy ?? false };
  const state: State = { users: options.missing ? [] : [user], tokens: [], sessions: ["current", "other"].map((id) => ({ id, userId: user.id, sessionVersion: 0, expiresAt: new Date(Date.now() + 60_000) })) };
  const delivered: Parameters<typeof mail.sendAuthEmail>[0][] = [];
  const deliver = async (input: Parameters<typeof mail.sendAuthEmail>[0]) => {
    if (options.failDelivery) throw new Error("private provider secret");
    if (options.delivered !== false) delivered.push(input);
    return options.delivered !== false;
  };
  t.mock.method(prisma.user, "findUnique", async ({ where }: { where: Record<string, unknown> }) => structuredClone(state.users.find((row) => matches(row, where)) ?? null));
  function delegates(pending: State) {
    function model<T extends object>(rows: T[], kind: string) {
      return {
        findUnique: async ({ where, include }: { where: Record<string, unknown>; include?: { user?: boolean } }) => {
          const row = rows.find((item) => matches(item, where));
          if (!row) return null;
          return structuredClone(include?.user ? { ...row, user: pending.users.find((userRow) => userRow.id === (row as Token).userId) } : row);
        },
        findFirst: async ({ where }: { where: Record<string, unknown> }) => structuredClone(rows.find((item) => matches(item, where)) ?? null),
        create: async ({ data }: { data: T }) => { const row = { id: `${kind}-${rows.length}`, consumedAt: null, ...data }; rows.push(row); return structuredClone(row); },
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          if (options.casMiss && kind === "user") return { count: 0 };
          let count = 0;
          for (const row of rows.filter((item) => matches(item, where))) {
            for (const [key, value] of Object.entries(data)) {
              const target = row as Record<string, unknown>;
              target[key] = value && typeof value === "object" && "increment" in value ? Number(target[key]) + Number(value.increment) : value;
            }
            count += 1;
          }
          return { count };
        },
        deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
          const removed = rows.filter((row) => matches(row, where));
          rows.splice(0, rows.length, ...rows.filter((row) => !removed.includes(row))); return { count: removed.length };
        },
      };
    }
    return { user: model(pending.users, "user"), authToken: model(pending.tokens, "token"), session: model(pending.sessions, "session") };
  }
  t.mock.method(prisma.authToken, "updateMany", async (input: { where: Record<string, unknown>; data: Record<string, unknown> }) => delegates(state).authToken.updateMany(input));
  t.mock.method(prisma, "$transaction", async (operation: (tx: unknown) => Promise<unknown>, settings: unknown) => {
    assert.deepEqual(settings, { isolationLevel: "Serializable" });
    const pending = structuredClone(state);
    const result = await operation(delegates(pending));
    if (options.transactionFails) throw new Error("private SQL details");
    Object.assign(state, pending); return result;
  });
  function addToken(overrides: Partial<Token> = {}) {
    const token: Token = { id: `token-${state.tokens.length}`, tokenHash: hashAuthToken(rawToken), userId: "user", email: user.email, sessionVersion: 0, purpose: "password_reset", expiresAt: new Date(Date.now() + 60_000), consumedAt: null, ...overrides };
    state.tokens.push(token); return token;
  }
  return { state, delivered, addToken, deliver };
}
const status = (expected: number) => (error: unknown) => error instanceof HttpError && error.status === expected;

test("new passwords preserve whitespace, require matching confirmation and enforce bounds", () => {
  assert.equal(account.validateNewAccountPassword(newPassword, newPassword), newPassword);
  for (const [password, confirmation] of [["short", "short"], ["x".repeat(201), "x".repeat(201)], [newPassword, "different"]]) {
    assert.throws(() => account.validateNewAccountPassword(password, confirmation), status(400));
  }
});

test("reset request stores only a hash and delivers a token outside the transaction", async (t) => {
  const { state, delivered, deliver } = await setup(t);
  await account.requestPasswordReset(" PERSON@example.invalid ", deliver);
  assert.equal(delivered.length, 1); assert.equal(state.tokens.length, 1);
  assert.equal(state.tokens[0].purpose, "password_reset");
  assert.ok(state.tokens[0].tokenHash !== delivered[0].token);
  assert.ok(state.tokens[0].tokenHash === hashAuthToken(delivered[0].token));
  assert.equal(state.users[0].sessionVersion, 0); assert.equal(state.sessions.length, 2);
});

test("unknown accounts and unverified legacy accounts receive no email recovery token", async (t) => {
  for (const options of [{ missing: true }, { verified: false, legacy: true }]) {
    const { state, delivered, deliver } = await setup(t, options);
    assert.equal(await account.requestPasswordReset("person@example.invalid", deliver), undefined);
    assert.equal(state.tokens.length, 0); assert.equal(delivered.length, 0);
    t.mock.restoreAll();
  }
});

test("failed delivery is not exposed by reset and leaves no usable token", async (t) => {
  for (const options of [{ failDelivery: true }, { delivered: false }]) {
    const { state, deliver } = await setup(t, options);
    assert.equal(await account.requestPasswordReset("person@example.invalid", deliver), undefined);
    assert.equal(state.tokens.filter((token) => token.consumedAt === null).length, 0);
    t.mock.restoreAll();
  }
});

test("verification request requires the current password and does not verify legacy email prematurely", async (t) => {
  const { state, delivered, deliver } = await setup(t, { verified: false, legacy: true });
  await assert.rejects(account.requestEmailVerification({ userId: "user", currentPassword: "wrong-password" }), status(400));
  assert.equal(state.tokens.length, 0);
  const result = await account.requestEmailVerification({ userId: "user", currentPassword }, deliver);
  assert.equal(result.delivered, true); assert.equal(delivered[0].kind, "verify_email");
  assert.equal(state.users[0].emailVerifiedAt, null); assert.equal(state.tokens[0].purpose, "verify_email");
});

test("verification consumes once and requires the same account, email and credential generation", async (t) => {
  const { state, addToken } = await setup(t, { verified: false, legacy: true });
  addToken({ purpose: "verify_email" });
  await assert.rejects(account.confirmEmailVerification({ userId: "foreign", token: rawToken }), status(400));
  await account.confirmEmailVerification({ userId: "user", token: rawToken });
  assert.ok(state.users[0].emailVerifiedAt instanceof Date);
  assert.ok(state.tokens[0].consumedAt instanceof Date);
  await assert.rejects(account.confirmEmailVerification({ userId: "user", token: rawToken }), status(400));
});

test("reset rejects expired, consumed, wrong-purpose, stale-generation and changed-email tokens", async (t) => {
  for (const changes of [{ expiresAt: new Date(0) }, { consumedAt: new Date(1) }, { purpose: "verify_email" }, { sessionVersion: 1 }, { email: "other@example.invalid" }]) {
    const { state, addToken } = await setup(t); addToken(changes);
    const before = structuredClone(state);
    await assert.rejects(account.resetAccountPassword({ token: rawToken, password: newPassword, passwordConfirmation: newPassword }), status(400));
    assert.deepEqual(state, before); t.mock.restoreAll();
  }
});

test("new-account reset proves email, rotates credentials, consumes all tokens and revokes all sessions exactly once", async (t) => {
  const { state, addToken } = await setup(t, { verified: false });
  addToken(); addToken({ tokenHash: hashAuthToken("b".repeat(64)), purpose: "verify_email" });
  await account.resetAccountPassword({ token: rawToken, password: newPassword, passwordConfirmation: newPassword });
  assert.equal(state.users[0].sessionVersion, 1); assert.ok(state.users[0].emailVerifiedAt instanceof Date);
  assert.equal(await verifyPassword(newPassword, state.users[0].passwordHash), true);
  assert.equal(await verifyPassword(newPassword.trim(), state.users[0].passwordHash), false);
  assert.equal(state.sessions.length, 0); assert.ok(state.tokens.every((token) => token.consumedAt));
  await assert.rejects(account.resetAccountPassword({ token: rawToken, password: newPassword, passwordConfirmation: newPassword }), status(400));
  assert.equal(state.users[0].sessionVersion, 1);
});

test("password change requires the current password and leaves email ownership unchanged", async (t) => {
  const { state, addToken } = await setup(t, { verified: false, legacy: true }); addToken();
  await assert.rejects(account.changeAccountPassword({ userId: "user", currentPassword: "wrong", password: newPassword, passwordConfirmation: newPassword }), status(400));
  assert.equal(state.sessions.length, 2);
  await account.changeAccountPassword({ userId: "user", currentPassword, password: newPassword, passwordConfirmation: newPassword });
  assert.equal(state.users[0].emailVerifiedAt, null); assert.equal(state.users[0].sessionVersion, 1);
  assert.equal(state.sessions.length, 0); assert.ok(state.tokens[0].consumedAt);
});

test("revoke others keeps only the current valid session and advances its credential generation", async (t) => {
  const { state } = await setup(t);
  await account.revokeOtherAccountSessions({ userId: "user", sessionId: "current", currentPassword });
  assert.equal(state.sessions.length, 1); assert.equal(state.sessions[0].id, "current");
  assert.equal(state.sessions[0].sessionVersion, 1); assert.equal(state.users[0].sessionVersion, 1);
  assert.equal(await verifyPassword(currentPassword, state.users[0].passwordHash), true);
});

test("revoke others rejects a foreign or expired current session without modifying records", async (t) => {
  const { state } = await setup(t); state.sessions[0].expiresAt = new Date(0);
  for (const sessionId of ["foreign", "current"]) {
    const before = structuredClone(state);
    await assert.rejects(account.revokeOtherAccountSessions({ userId: "user", sessionId, currentPassword }), status(401));
    assert.deepEqual(state, before);
  }
});

test("failed credential CAS or transaction commit rolls back token consumption and session revocation", async (t) => {
  for (const options of [{ casMiss: true }, { transactionFails: true }]) {
    const { state, addToken } = await setup(t, options); addToken();
    const before = structuredClone(state);
    await assert.rejects(account.resetAccountPassword({ token: rawToken, password: newPassword, passwordConfirmation: newPassword }));
    assert.deepEqual(state, before); t.mock.restoreAll();
  }
});
