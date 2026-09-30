import type { PrismaClient, User } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { assertTestDatabaseUrl } from "../../scripts/test-environment";

// This guard runs even when somebody bypasses npm and executes this test file directly.
// No runtime Prisma/auth/repository imports are allowed before this assignment.
process.env.DATABASE_URL = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);

let testPrisma: PrismaClient | undefined;

export async function getTestPrisma() {
  testPrisma ??= (await import("@/lib/prisma")).prisma;
  return testPrisma;
}

export async function disconnectTestPrisma() {
  await testPrisma?.$disconnect();
}

export async function withTestUser(
  run: (context: { prisma: PrismaClient; user: User; password: string }) => Promise<void>,
) {
  const prisma = await getTestPrisma();
  const { hashPassword } = await import("@/lib/auth");
  const fixtureId = randomUUID();
  const password = "integration-test-password";
  const user = await prisma.user.create({
    data: {
      id: `integration-user-${fixtureId}`,
      firstName: "Тест",
      lastName: "Создатель",
      email: `integration-${fixtureId}@example.invalid`,
      passwordHash: await hashPassword(password),
    },
  });
  try {
    await run({ prisma, user, password });
  } finally {
    // Only this fixture user's own families are removed; sessions cascade with the user.
    // This also cleans families created before an assertion throws.
    try {
      await prisma.family.deleteMany({
        where: { memberships: { some: { userId: user.id, role: "owner" } } },
      });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  }
}
