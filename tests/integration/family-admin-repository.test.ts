import test, { after } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "@/lib/slug";
import { disconnectTestPrisma, withTestUser } from "./helpers";

after(disconnectTestPrisma);

test("createFamilySpace creates an owner membership and resolves slug collisions", async () => {
  await withTestUser(async ({ prisma, user }) => {
    const { createFamilySpace } = await import("@/lib/family-admin-repository");
    const surname = `Создатели-${user.id}`;
    const expectedSlug = slugify(surname);
    const input = { title: "Род Создателей", surname, region: "Баку", description: "Integration fixture" };
    const firstFamily = await createFamilySpace({ user, input });
    const secondFamily = await createFamilySpace({ user, input });
    assert.match(expectedSlug, /^[a-z0-9-]+$/);
    assert.equal(firstFamily.slug, expectedSlug);
    assert.equal(secondFamily.slug, `${expectedSlug}-2`);
    const membership = await prisma.familyMembership.findFirst({
      where: { family: { slug: firstFamily.slug }, userId: user.id },
    });
    assert.equal(membership?.role, "owner");
  });
});

test("listFamiliesForUser returns only this user's family with its role and stats", async () => {
  await withTestUser(async ({ user }) => {
    const { createFamilySpace, listFamiliesForUser } = await import("@/lib/family-admin-repository");
    const created = await createFamilySpace({
      user,
      input: { title: "Род Семейных", surname: user.id, region: "Губа", description: "Integration fixture" },
    });
    const families = await listFamiliesForUser(user.id);
    assert.equal(families.length, 1);
    assert.equal(families[0].slug, created.slug);
    assert.equal(families[0].role, "owner");
    assert.equal(families[0].stats.people, 0);
    assert.equal(families[0].stats.photos, 0);
    assert.equal(families[0].title, "Род Семейных");
    assert.deepEqual(await listFamiliesForUser(`missing-${user.id}`), []);
  });
});
