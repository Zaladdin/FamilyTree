import test from "node:test";
import assert from "node:assert/strict";
import { addPersonToFamily, findDuplicatePerson } from "@/lib/family-logic";
import { getFamilyBySlug } from "@/lib/mock-data";

function cloneDemoFamily() {
  const family = getFamilyBySlug("akhmedov");

  if (!family) {
    throw new Error("Demo family not found.");
  }

  return structuredClone(family);
}

test("person creation preserves deceased details and clears death dates for living people", () => {
  for (const status of [undefined, "living", "deceased"] as const) {
    const result = addPersonToFamily(cloneDemoFamily(), {
      firstName: "Тестовая", lastName: "Карточка", gender: "female", birthDate: "1950",
      birthPlace: "Баку", relationshipKind: "spouse", relativePersonId: "timur",
      status, deathDate: " 2020 ",
    });
    assert.equal(result.person.status, status ?? "living");
    assert.equal(result.person.deathDate, status === "deceased" ? "2020" : undefined);
  }
});

test("addPersonToFamily automatically links child to spouse when there is exactly one spouse", () => {
  const family = cloneDemoFamily();
  const result = addPersonToFamily(family, {
    firstName: "Марьям",
    lastName: "Ахмедова",
    gender: "female",
    birthDate: "2027",
    birthPlace: "Баку",
    relationshipKind: "child",
    relativePersonId: "timur",
  });

  const parentLinks = result.family.relationships.filter(
    (relationship) =>
      relationship.type === "parent" && relationship.toPersonId === result.person.id,
  );

  assert.equal(parentLinks.length, 2);
  assert.deepEqual(
    parentLinks.map((relationship) => relationship.fromPersonId).sort(),
    ["leyla", "timur"],
  );
});

test("addPersonToFamily records siblings even when selected person has no known parents", () => {
  const family = cloneDemoFamily();
  family.people.push({
    id: "solo",
    firstName: "Соло",
    lastName: "Ахмедов",
    gender: "male",
    birthDate: "2000",
    birthPlace: "Баку",
    status: "living",
    isArchived: false,
    biography: "Тестовый человек без родителей.",
    timeline: [],
    media: { photos: 0, audio: 0, documents: 0 },
    mediaAssets: [],
    stories: [],
  });

  const result = addPersonToFamily(family, {
        firstName: "Брат",
        lastName: "Ахмедов",
        gender: "male",
        birthDate: "2002",
        birthPlace: "Баку",
        relationshipKind: "sibling",
        relativePersonId: "solo",
      });
  assert.deepEqual(result.family.relationships.slice(family.relationships.length), [
    { type: "sibling", fromPersonId: result.person.id, toPersonId: "solo" },
  ]);
});

test("new people inherit spouse and sibling parents while explicit choices keep priority", () => {
  const family = cloneDemoFamily();
  const input = {
    firstName: "Новая", lastName: "Карточка", gender: "female" as const,
    birthDate: "2000", birthPlace: "Баку", relationshipKind: "child" as const, relativePersonId: "timur",
  };
  const one = addPersonToFamily(family, { ...input, additionalRelationships: [] });
  assert.deepEqual(one.family.relationships.slice(family.relationships.length), [
    { type: "parent", fromPersonId: "timur", toPersonId: one.person.id },
    { type: "parent", fromPersonId: "leyla", toPersonId: one.person.id, origin: "spouse", sourcePersonId: "timur" },
  ]);
  const both = addPersonToFamily(family, { ...input,
    additionalRelationships: [{ relationshipKind: "child", relativePersonId: "leyla" }],
  });
  assert.deepEqual(both.family.relationships.slice(family.relationships.length), [
    { type: "parent", fromPersonId: "timur", toPersonId: both.person.id },
    { type: "parent", fromPersonId: "leyla", toPersonId: both.person.id },
  ]);
  const sibling = addPersonToFamily(family, { ...input, relationshipKind: "sibling", relativePersonId: "ilyas" });
  assert.deepEqual(sibling.family.relationships.slice(family.relationships.length), [
    { type: "sibling", fromPersonId: sibling.person.id, toPersonId: "ilyas" },
    { type: "parent", fromPersonId: "ahmed", toPersonId: sibling.person.id, origin: "sibling", sourcePersonId: "ilyas" },
    { type: "parent", fromPersonId: "amina", toPersonId: sibling.person.id, origin: "sibling", sourcePersonId: "ilyas" },
  ]);
});

test("multiple creation relationships reject missing people, repeated roles, cycles and third parents without mutating input", () => {
  const family = cloneDemoFamily();
  const before = structuredClone(family);
  const input = {
    firstName: "Новая", lastName: "Карточка", gender: "female" as const,
    birthDate: "2000", birthPlace: "Баку", relationshipKind: "child" as const, relativePersonId: "timur",
  };
  for (const additionalRelationships of [
    [{ relationshipKind: "child" as const, relativePersonId: "foreign" }],
    [{ relationshipKind: "child" as const, relativePersonId: "timur" }],
    [{ relationshipKind: "parent" as const, relativePersonId: "timur" }],
    [{ relationshipKind: "child" as const, relativePersonId: "leyla" }, { relationshipKind: "child" as const, relativePersonId: "ilyas" }],
  ]) assert.throws(() => addPersonToFamily(family, { ...input, additionalRelationships }));
  assert.deepEqual(family, before);
});

test("findDuplicatePerson also checks archived people", () => {
  const family = cloneDemoFamily();
  family.archivedPeople.push({
    id: "archived-person",
    firstName: "Арсен",
    lastName: "Ахмедов",
    middleName: "Тимурович",
    gender: "male",
    birthDate: "2015",
    birthPlace: "Баку",
    status: "living",
    isArchived: true,
    biography: "Архивная запись",
    timeline: [],
    media: { photos: 0, audio: 0, documents: 0 },
    mediaAssets: [],
    stories: [],
  });

  const duplicate = findDuplicatePerson(family, {
    firstName: "Арсен",
    lastName: "Ахмедов",
    middleName: "Тимурович",
    gender: "male",
    birthDate: "2015",
    birthPlace: "Баку",
    relationshipKind: "child",
    relativePersonId: "timur",
  });

  assert.ok(duplicate);
  assert.equal(duplicate?.id, "archived-person");
});
