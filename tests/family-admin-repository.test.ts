import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createFamilySpace, listFamiliesForUser } from "@/lib/family-admin-repository";
import { prisma } from "@/lib/prisma";

after(async () => {
  await prisma.$disconnect();
});

test("createFamilySpace creates owner membership and unique slug", async () => {
  const user = await prisma.user.create({
    data: {
      firstName: "Тест",
      lastName: "Создатель",
      email: `creator-${Date.now()}@rodovo.app`,
      passwordHash: "test-hash",
    },
  });

  const firstFamily = await createFamilySpace({
    user,
    input: {
      title: "Род Создателей",
      surname: "Создатели",
      region: "Баку",
      description: "Первая семья для теста.",
    },
  });

  const secondFamily = await createFamilySpace({
    user,
    input: {
      title: "Род Создателей",
      surname: "Создатели",
      region: "Баку",
      description: "Вторая семья для теста.",
    },
  });

  assert.equal(firstFamily.slug, "создатели");
  assert.equal(secondFamily.slug, "создатели-2");

  const membership = await prisma.familyMembership.findFirst({
    where: {
      family: { slug: firstFamily.slug },
      userId: user.id,
    },
  });

  assert.ok(membership);
  assert.equal(membership?.role, "owner");
});

test("listFamiliesForUser returns user families with role and stats", async () => {
  const user = await prisma.user.create({
    data: {
      firstName: "Список",
      lastName: "Семей",
      email: `families-${Date.now()}@rodovo.app`,
      passwordHash: "test-hash",
    },
  });

  const createdFamily = await createFamilySpace({
    user,
    input: {
      title: "Род Семейных",
      surname: "Семейные",
      region: "Губа",
      description: "Семья для проверки списка.",
    },
  });

  const families = await listFamiliesForUser(user.id);
  const summary = families.find((family) => family.slug === createdFamily.slug);

  assert.ok(summary);
  assert.equal(summary?.role, "owner");
  assert.equal(summary?.stats.people, 0);
  assert.equal(summary?.stats.photos, 0);
  assert.equal(summary?.title, "Род Семейных");
});
