import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createFamilySpace, listFamiliesForUser } from "@/lib/family-admin-repository";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";

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

  // Unique surname per run: slugs live in a shared dev database, so a fixed
  // surname would collide with leftovers from previous runs.
  const surname = `Создатели${Date.now()}`;
  const expectedSlug = slugify(surname);

  const firstFamily = await createFamilySpace({
    user,
    input: {
      title: "Род Создателей",
      surname,
      region: "Баку",
      description: "Первая семья для теста.",
    },
  });

  const secondFamily = await createFamilySpace({
    user,
    input: {
      title: "Род Создателей",
      surname,
      region: "Баку",
      description: "Вторая семья для теста.",
    },
  });

  assert.match(expectedSlug, /^[a-z0-9-]+$/, "слаг должен быть ASCII после транслитерации");
  assert.equal(firstFamily.slug, expectedSlug);
  assert.equal(secondFamily.slug, `${expectedSlug}-2`);

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
