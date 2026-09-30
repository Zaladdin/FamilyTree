import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  hashSessionToken,
  normalizeSafeRedirectPath,
  verifyPassword,
} from "@/lib/auth";

test("hashPassword and verifyPassword work together", async () => {
  const hash = await hashPassword("super-secret");

  assert.equal(await verifyPassword("super-secret", hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
});

test("password hashes use a fresh salt and malformed hashes are rejected", async () => {
  const first = await hashPassword("super-secret");
  const second = await hashPassword("super-secret");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("super-secret", "invalid-hash"), false);
  assert.equal(await verifyPassword("super-secret", "salt:00"), false);
});

test("session tokens are hashed deterministically without retaining plaintext", () => {
  const token = "random-session-token";
  assert.match(hashSessionToken(token), /^[a-f0-9]{64}$/);
  assert.equal(hashSessionToken(token), hashSessionToken(token));
  assert.notEqual(hashSessionToken(token), hashSessionToken("another-token"));
  assert.notEqual(hashSessionToken(token), token);
});

test("normalizeSafeRedirectPath keeps only internal app paths", () => {
  assert.equal(normalizeSafeRedirectPath("/family/akhmedov?person=timur"), "/family/akhmedov?person=timur");
  assert.equal(normalizeSafeRedirectPath("https://evil.example"), "/families");
  assert.equal(normalizeSafeRedirectPath("//evil.example"), "/families");
  assert.equal(normalizeSafeRedirectPath("/\\evil.example"), "/families");
  assert.equal(normalizeSafeRedirectPath("/%2F%2Fevil.example"), "/families");
  assert.equal(normalizeSafeRedirectPath("/family/akhmedov\r\nLocation:https://evil.example"), "/families");
});
