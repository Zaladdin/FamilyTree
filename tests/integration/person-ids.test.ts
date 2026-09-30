import test, { after } from "node:test";
import assert from "node:assert/strict";
import { disconnectTestPrisma, withTestUser } from "./helpers";

after(disconnectTestPrisma);

test("identical people across families have unique IDs with valid relationships and audit references", async () => {
  await withTestUser(async ({ prisma, user }) => {
    const { createFamilySpace } = await import("@/lib/family-admin-repository");
    const { createPersonInFamily } = await import("@/lib/family-repository");
    const input = {
      firstName: "Тест", lastName: "Одинаковый", gender: "male" as const,
      birthDate: "1980", birthPlace: "Баку", relationshipKind: "spouse" as const, relativePersonId: "",
    };
    const createdIds: string[] = [];
    for (const suffix of ["first", "second"]) {
      const family = await createFamilySpace({
        user,
        input: { title: "Тест ID", surname: `${user.id}-${suffix}`, region: "Баку", description: "Integration fixture" },
      });
      const parent = await createPersonInFamily(family.slug, input, "Тест", user.id);
      const child = await createPersonInFamily(family.slug, {
        ...input, firstName: "Ребёнок", birthDate: "2010", relationshipKind: "child", relativePersonId: parent.id,
      }, "Тест", user.id);
      createdIds.push(parent.id, child.id);
      const persisted = await prisma.person.findUniqueOrThrow({ where: { id: child.id } });
      const edge = await prisma.relationship.findFirst({ where: {
        familyId: persisted.familyId, type: "parent", fromPersonId: parent.id, toPersonId: child.id,
      } });
      assert.ok(edge);
      assert.equal(await prisma.auditLog.count({ where: { familyId: persisted.familyId, personId: child.id, action: "person_created" } }), 1);
      await assert.rejects(createPersonInFamily(family.slug, input, "Тест", user.id), /уже есть в этой семье/);
    }
    assert.equal(new Set(createdIds).size, 4);
  });
});
