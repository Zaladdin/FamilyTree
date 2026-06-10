import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  authenticateUser,
  createSession,
  getFamilyRoleForUserId,
  hashPassword,
  hashSessionToken,
  normalizeSafeRedirectPath,
  verifyPassword,
} from "@/lib/auth";
import { HttpError } from "@/lib/http-error";
import { prisma } from "@/lib/prisma";

after(async () => {
  await prisma.$disconnect();
});

test("hashPassword and verifyPassword work together", async () => {
  const hash = await hashPassword("super-secret");

  assert.equal(await verifyPassword("super-secret", hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
});

test("authenticateUser allows seeded demo user and rejects bad password", async () => {
  const user = await authenticateUser("timur@rodovo.app", "12345678");

  assert.equal(user.email, "timur@rodovo.app");

  await assert.rejects(
    () => authenticateUser("timur@rodovo.app", "bad-password"),
    (error) =>
      error instanceof HttpError &&
      error.status === 401 &&
      /Неверный email или пароль/.test(error.message),
  );
});

test("getFamilyRoleForUserId returns membership role for seeded family", async () => {
  const role = await getFamilyRoleForUserId("user-timur", "akhmedov");

  assert.equal(role, "owner");
});

test("createSession stores only token hash in database", async () => {
  const session = await createSession("user-timur");
  const stored = await prisma.session.findFirst({
    where: {
      userId: "user-timur",
      tokenHash: hashSessionToken(session.token),
    },
  });

  assert.ok(stored);
  assert.equal(stored?.tokenHash, hashSessionToken(session.token));
  assert.notEqual(stored?.tokenHash, session.token);
});

test("normalizeSafeRedirectPath keeps only internal app paths", () => {
  assert.equal(normalizeSafeRedirectPath("/family/akhmedov?person=timur"), "/family/akhmedov?person=timur");
  assert.equal(normalizeSafeRedirectPath("https://evil.example"), "/families");
  assert.equal(normalizeSafeRedirectPath("//evil.example"), "/families");
  assert.equal(normalizeSafeRedirectPath("/\\evil.example"), "/families");
  assert.equal(normalizeSafeRedirectPath("/%2F%2Fevil.example"), "/families");
  assert.equal(normalizeSafeRedirectPath("/family/akhmedov\r\nLocation:https://evil.example"), "/families");
});
