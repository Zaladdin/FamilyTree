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

test("addPersonToFamily rejects sibling creation when selected person has no known parents", () => {
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

  assert.throws(
    () =>
      addPersonToFamily(family, {
        firstName: "Брат",
        lastName: "Ахмедов",
        gender: "male",
        birthDate: "2002",
        birthPlace: "Баку",
        relationshipKind: "sibling",
        relativePersonId: "solo",
      }),
    /Сначала укажите родителя/,
  );
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
