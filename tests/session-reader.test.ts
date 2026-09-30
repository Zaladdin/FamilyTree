import test from "node:test";
import assert from "node:assert/strict";
import { hashSessionToken, readValidSession } from "@/lib/session-reader";

const now = Date.parse("2026-09-13T00:00:00Z");

test("no cookie means no session lookup", async () => {
  const lookup = async () => { throw new Error("Unexpected database access"); };
  assert.equal(await readValidSession(undefined, lookup, now), null);
  assert.equal(await readValidSession("", lookup, now), null);
});

test("session lookup receives a hash, not the raw cookie", async () => {
  const session = { id: "test-session", expiresAt: new Date(now + 1), sessionVersion: 0, user: { id: "test-user", sessionVersion: 0 } };
  const result = await readValidSession("private-token", async (hash) => {
    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.equal(hash, hashSessionToken("private-token"));
    assert.notEqual(hash, "private-token");
    return session;
  }, now);
  assert.equal(result, session);
});

test("expired and unknown sessions return null without mutating session data", async () => {
  for (const expiresAt of [new Date(now - 1), new Date(now), new Date("invalid")]) {
    const session = Object.freeze({ id: "expired", expiresAt });
    assert.equal(await readValidSession("token", async () => session, now), null);
    assert.equal(session.id, "expired");
    assert.equal(session.expiresAt, expiresAt);
  }
  assert.equal(await readValidSession("token", async () => null, now), null);
});

test("database failures are not mistaken for anonymous sessions", async () => {
  await assert.rejects(
    readValidSession("token", async () => { throw new Error("Database unavailable"); }, now),
    /Database unavailable/,
  );
});

test("credential generations invalidate a login issued after a concurrent password reset", async () => {
  const session = { expiresAt: new Date(now + 60_000), sessionVersion: 0, user: { sessionVersion: 1 } };
  assert.equal(await readValidSession("old-login", async () => session, now), null);
  assert.equal((await readValidSession("new-login", async () => ({ ...session, sessionVersion: 1 }), now))?.sessionVersion, 1);
});
