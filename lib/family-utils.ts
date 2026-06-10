import { Family, FamilyPerson, FocusRelatives } from "@/lib/types";

export function getPersonFullName(person: FamilyPerson) {
  return [person.firstName, person.middleName, person.lastName]
    .filter(Boolean)
    .join(" ");
}

function uniquePeople(people: FamilyPerson[]) {
  return Array.from(new Map(people.map((person) => [person.id, person])).values());
}

export function getFocusRelatives(
  family: Family,
  focusPersonId: string,
): FocusRelatives {
  const personMap = new Map(family.people.map((person) => [person.id, person]));

  const parents = family.relationships
    .filter(
      (relationship) =>
        relationship.type === "parent" && relationship.toPersonId === focusPersonId,
    )
    .map((relationship) => personMap.get(relationship.fromPersonId))
    .filter((person): person is FamilyPerson => Boolean(person));

  const children = family.relationships
    .filter(
      (relationship) =>
        relationship.type === "parent" && relationship.fromPersonId === focusPersonId,
    )
    .map((relationship) => personMap.get(relationship.toPersonId))
    .filter((person): person is FamilyPerson => Boolean(person));

  const spouses = family.relationships
    .filter(
      (relationship) =>
        relationship.type === "spouse" &&
        (relationship.fromPersonId === focusPersonId ||
          relationship.toPersonId === focusPersonId),
    )
    .map((relationship) =>
      relationship.fromPersonId === focusPersonId
        ? personMap.get(relationship.toPersonId)
        : personMap.get(relationship.fromPersonId),
    )
    .filter((person): person is FamilyPerson => Boolean(person));

  const parentIds = new Set(parents.map((parent) => parent.id));

  const siblings = uniquePeople(
    family.relationships
      .filter(
        (relationship) =>
          relationship.type === "parent" && parentIds.has(relationship.fromPersonId),
      )
      .map((relationship) => personMap.get(relationship.toPersonId))
      .filter((person): person is FamilyPerson => Boolean(person))
      .filter((person) => person.id !== focusPersonId),
  );

  return { parents, spouses, siblings, children };
}
