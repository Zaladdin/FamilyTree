import { Family, FamilyPerson, FamilyRelationship, Gender } from "@/lib/types";

export type AddRelationshipKind = "parent" | "child" | "spouse" | "sibling";

export type AddPersonInput = {
  firstName: string;
  lastName: string;
  middleName?: string;
  gender: Gender;
  birthDate: string;
  birthPlace: string;
  biography?: string;
  relationshipKind: AddRelationshipKind;
  relativePersonId: string;
};

export type UpdatePersonInput = {
  firstName: string;
  lastName: string;
  middleName?: string;
  gender: Gender;
  birthDate: string;
  birthPlace: string;
  biography: string;
  note?: string;
  status: FamilyPerson["status"];
  deathDate?: string;
};

export function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function makeSlugPiece(value: string) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

function personDisplayNameForTimeline(person: AddPersonInput) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

function makePersonId(family: Family, person: AddPersonInput) {
  const base = [person.firstName, person.lastName, person.birthDate]
    .map(makeSlugPiece)
    .filter(Boolean)
    .join("-");

  const taken = new Set(
    [...family.people, ...family.archivedPeople].map((existingPerson) => existingPerson.id),
  );
  let candidate = base || `person-${family.people.length + 1}`;
  let counter = 2;

  while (taken.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }

  return candidate;
}

function sameNormalized(left?: string, right?: string) {
  return normalizeText(left ?? "").toLowerCase() === normalizeText(right ?? "").toLowerCase();
}

function getAllPeople(family: Family) {
  return [...family.people, ...family.archivedPeople];
}

export function findDuplicatePerson(family: Family, input: AddPersonInput) {
  return getAllPeople(family).find(
    (person) =>
      sameNormalized(person.firstName, input.firstName) &&
      sameNormalized(person.lastName, input.lastName) &&
      sameNormalized(person.middleName, input.middleName) &&
      sameNormalized(person.birthDate, input.birthDate),
  );
}

export function findDuplicatePersonForUpdate(
  family: Family,
  personId: string,
  input: UpdatePersonInput,
) {
  return getAllPeople(family).find(
    (person) =>
      person.id !== personId &&
      sameNormalized(person.firstName, input.firstName) &&
      sameNormalized(person.lastName, input.lastName) &&
      sameNormalized(person.middleName, input.middleName) &&
      sameNormalized(person.birthDate, input.birthDate),
  );
}

function hasRelationship(
  relationships: FamilyRelationship[],
  nextRelationship: FamilyRelationship,
) {
  return relationships.some(
    (relationship) =>
      relationship.type === nextRelationship.type &&
      relationship.fromPersonId === nextRelationship.fromPersonId &&
      relationship.toPersonId === nextRelationship.toPersonId,
  );
}

function ensureRelationship(
  relationships: FamilyRelationship[],
  nextRelationship: FamilyRelationship,
) {
  if (hasRelationship(relationships, nextRelationship)) {
    return relationships;
  }

  return [...relationships, nextRelationship];
}

function getParents(family: Family, personId: string) {
  return family.relationships
    .filter(
      (relationship) =>
        relationship.type === "parent" && relationship.toPersonId === personId,
    )
    .map((relationship) => relationship.fromPersonId);
}

function getSpouses(family: Family, personId: string) {
  return family.relationships
    .filter(
      (relationship) =>
        relationship.type === "spouse" &&
        (relationship.fromPersonId === personId || relationship.toPersonId === personId),
    )
    .map((relationship) =>
      relationship.fromPersonId === personId
        ? relationship.toPersonId
        : relationship.fromPersonId,
    );
}

export function addPersonToFamily(
  family: Family,
  input: AddPersonInput,
): { family: Family; person: FamilyPerson } {
  const duplicate = findDuplicatePerson(family, input);

  if (duplicate) {
    throw new Error(
      `Человек "${[duplicate.firstName, duplicate.middleName, duplicate.lastName]
        .filter(Boolean)
        .join(" ")}" с датой рождения ${duplicate.birthDate} уже есть в этой семье.`,
    );
  }

  const relativePerson = family.people.find(
    (person) => person.id === input.relativePersonId,
  );

  if (!relativePerson) {
    throw new Error("Не удалось найти выбранного родственника для связи.");
  }

  const normalizedInput: AddPersonInput = {
    ...input,
    firstName: normalizeText(input.firstName),
    lastName: normalizeText(input.lastName),
    middleName: normalizeText(input.middleName ?? ""),
    birthDate: normalizeText(input.birthDate),
    birthPlace: normalizeText(input.birthPlace),
    biography: normalizeText(input.biography ?? ""),
  };

  const nextPerson: FamilyPerson = {
    id: makePersonId(family, normalizedInput),
    firstName: normalizedInput.firstName,
    lastName: normalizedInput.lastName,
    middleName: normalizedInput.middleName || undefined,
    gender: normalizedInput.gender,
    birthDate: normalizedInput.birthDate,
    birthPlace: normalizedInput.birthPlace,
    status: "living",
    isArchived: false,
    biography:
      normalizedInput.biography ||
      `${personDisplayNameForTimeline(normalizedInput)} добавлен(а) в семейное дерево. Биография будет заполнена позже.`,
    note: "Карточка создана в MVP через форму добавления человека.",
    timeline: [
      `${normalizedInput.birthDate} - рождение`,
      `2026 - добавлен(а) в цифровое дерево семьи`,
    ],
    media: { photos: 0, audio: 0, documents: 0 },
    mediaAssets: [],
    stories: [],
  };

  let nextRelationships = [...family.relationships];

  if (normalizedInput.relationshipKind === "spouse") {
    nextRelationships = ensureRelationship(nextRelationships, {
      type: "spouse",
      fromPersonId: relativePerson.id,
      toPersonId: nextPerson.id,
    });
  }

  if (normalizedInput.relationshipKind === "child") {
    nextRelationships = ensureRelationship(nextRelationships, {
      type: "parent",
      fromPersonId: relativePerson.id,
      toPersonId: nextPerson.id,
    });

    const spouses = getSpouses(family, relativePerson.id);

    if (spouses.length === 1) {
      nextRelationships = ensureRelationship(nextRelationships, {
        type: "parent",
        fromPersonId: spouses[0],
        toPersonId: nextPerson.id,
      });
    }
  }

  if (normalizedInput.relationshipKind === "parent") {
    nextRelationships = ensureRelationship(nextRelationships, {
      type: "parent",
      fromPersonId: nextPerson.id,
      toPersonId: relativePerson.id,
    });
  }

  if (normalizedInput.relationshipKind === "sibling") {
    const parents = getParents(family, relativePerson.id);

    if (!parents.length) {
      throw new Error(
        "Нельзя добавить брата или сестру без известных родителей выбранного человека. Сначала укажите родителя.",
      );
    }

    nextRelationships = parents.reduce(
      (relationships, parentId) =>
        ensureRelationship(relationships, {
          type: "parent",
          fromPersonId: parentId,
          toPersonId: nextPerson.id,
        }),
      nextRelationships,
    );
  }

  const nextFamily: Family = {
    ...family,
    stats: {
      ...family.stats,
      people: family.stats.people + 1,
    },
    people: [...family.people, nextPerson],
    archivedPeople: family.archivedPeople,
    relationships: nextRelationships,
    auditLog: family.auditLog,
  };

  return { family: nextFamily, person: nextPerson };
}
