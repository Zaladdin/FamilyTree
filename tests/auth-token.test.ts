import test from "node:test";
import assert from "node:assert/strict";
import { generateAuthToken, hashAuthToken, parseAuthToken, authTokenExpiry } from "@/lib/auth-token";

test("action tokens use independent random 256-bit secrets and SHA-256 hashes", () => {
  const first = generateAuthToken();
  const second = generateAuthToken();
  assert.match(first.token, /^[a-f0-9]{64}$/);
  assert.match(first.tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(first.token, first.tokenHash);
  assert.notEqual(first.token, second.token);
  assert.equal(hashAuthToken(first.token), first.tokenHash);
  assert.equal(parseAuthToken(first.token), first.token);
});

test("action token parser rejects missing, malformed and excessively large secrets", () => {
  for (const value of [undefined, null, 1, [], {}, "", "a".repeat(63), "g".repeat(64), "a".repeat(65), ` ${"a".repeat(64)}`]) {
    assert.throws(() => parseAuthToken(value), /ссылк/i);
  }
});

test("action tokens have bounded configurable purpose-specific lifetimes", (t) => {
  const keys = ["AUTH_VERIFY_EMAIL_TTL_SECONDS", "AUTH_PASSWORD_RESET_TTL_SECONDS", "AUTH_INVITATION_TTL_SECONDS"];
  const before = keys.map((key) => process.env[key]);
  t.after(() => keys.forEach((key, i) => { if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i]; }));
  keys.forEach((key) => { delete process.env[key]; });
  const now = new Date("2026-09-28T00:00:00Z");
  assert.equal(authTokenExpiry("verify_email", now).getTime() - now.getTime(), 86400_000);
  assert.equal(authTokenExpiry("password_reset", now).getTime() - now.getTime(), 1800_000);
  assert.equal(authTokenExpiry("invitation", now).getTime() - now.getTime(), 604800_000);
  process.env.AUTH_PASSWORD_RESET_TTL_SECONDS = "600";
  assert.equal(authTokenExpiry("password_reset", now).getTime() - now.getTime(), 600_000);
  for (const value of ["0", "-1", "Infinity", "abc", "2.5", "999999999"]) {
    process.env.AUTH_PASSWORD_RESET_TTL_SECONDS = value;
    assert.throws(() => authTokenExpiry("password_reset", now), /TTL/);
  }
});
