import { Family, FamilyPerson, Gender } from "@/lib/types";
import { slugify } from "@/lib/slug";
import { addRelationshipToFamily, parseAddExistingRelationshipInput } from "@/lib/family-relationships";
import { HttpError } from "@/lib/http-error";
import { applyAutomaticParenthood, type ParentInferenceWarning } from "@/lib/family-parent-inference";
import { normalizeMultilineText } from "@/lib/content-text";
import { buildPersonTimeline, createPersonTimelineEvents } from "@/lib/person-timeline";

export type AddRelationshipKind = "parent" | "child" | "spouse" | "sibling";

export type PersonRelationshipInput = {
  relationshipKind: AddRelationshipKind;
  relativePersonId: string;
  relativeClientId?: string;
};

export const MAX_ADDITIONAL_RELATIONSHIPS = 9;

export type AddPersonInput = {
  firstName: string;
  lastName: string;
  middleName?: string;
  gender: Gender;
  birthDate: string;
  birthPlace: string;
  biography?: string;
  status?: FamilyPerson["status"];
  deathDate?: string;
  relationshipKind: AddRelationshipKind;
  relativePersonId: string;
  sharedChildIds?: string[];
  additionalRelationships?: PersonRelationshipInput[];
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

export type PersonUpdateRequest = UpdatePersonInput & {
  expectedVersion: number;
};

export function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function personDisplayNameForTimeline(person: AddPersonInput) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

function makePersonId(family: Family, person: AddPersonInput) {
  const base = [person.firstName, person.lastName, person.birthDate]
    .map(slugify)
    .filter(Boolean)
    .join("-");

  const taken = new Set(
    [...family.people, ...family.archivedPeople].map((existingPerson) => existingPerson.id),
  );
  let candidate = base || `person-${family.people.length + 1}`;
  let counter = 2;

  while (taken.has(candidate)) {
    candidate = `${base || "person"}-${counter}`;
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

function getParents(family: Family, personId: string) {
  return family.relationships
    .filter(
      (relationship) =>
        relationship.type === "parent" && relationship.toPersonId === personId,
    )
    .map((relationship) => relationship.fromPersonId);
}

/** Candidates for legacy clients that explicitly select shared children. */
export function getSharedChildrenCandidates(family: Family, relativePersonId: string) {
  const childIds = new Set(family.relationships
    .filter((relationship) => relationship.type === "parent" && relationship.fromPersonId === relativePersonId)
    .map((relationship) => relationship.toPersonId));
  return family.people.filter((person) =>
    !person.isArchived && childIds.has(person.id) && new Set(getParents(family, person.id)).size < 2,
  );
}

export function addPersonToFamily(
  family: Family,
  input: AddPersonInput,
  options: { deferInference?: boolean } = {},
): { family: Family; person: FamilyPerson; warnings: ParentInferenceWarning[] } {
  const duplicate = findDuplicatePerson(family, input);

  if (duplicate) {
    throw new HttpError(400,
      `Человек "${[duplicate.firstName, duplicate.middleName, duplicate.lastName]
        .filter(Boolean)
        .join(" ")}" с датой рождения ${duplicate.birthDate} уже есть в этой семье.`,
    );
  }

  // The very first person in an empty family is added standalone (no relative).
  const isFirstPerson = family.people.length === 0;
  const relativePerson = isFirstPerson
    ? undefined
    : family.people.find((person) => !person.isArchived && person.id === input.relativePersonId);

  if (!isFirstPerson && !relativePerson) {
    throw new HttpError(400, "Не удалось найти выбранного родственника для связи.");
  }
  const additionalRelationships = input.additionalRelationships === undefined ? [] : input.additionalRelationships;
  if (!Array.isArray(additionalRelationships) || additionalRelationships.length > MAX_ADDITIONAL_RELATIONSHIPS) {
    throw new HttpError(400, `Можно указать не более ${MAX_ADDITIONAL_RELATIONSHIPS + 1} связей для одного человека.`);
  }
  if (isFirstPerson && (input.relativePersonId || additionalRelationships.length)) {
    throw new HttpError(400, "Первый человек в пустом дереве добавляется без родственника.");
  }
  const explicitLinks: PersonRelationshipInput[] = relativePerson ? [{
    relationshipKind: input.relationshipKind, relativePersonId: relativePerson.id,
  }, ...additionalRelationships] : [];
  const seenLinks = new Set<string>();
  for (const link of explicitLinks) {
    const parsed = parseAddExistingRelationshipInput(link);
    if (link.relativeClientId) throw new HttpError(400, "Сначала разрешите связь с карточкой списка.");
    const key = `${parsed.relationshipKind}:${parsed.relativePersonId}`;
    if (seenLinks.has(key)) throw new HttpError(400, "Одна и та же родственная связь указана несколько раз.");
    seenLinks.add(key);
  }

  const requestedChildren = input.sharedChildIds === undefined ? [] : input.sharedChildIds;
  if (!Array.isArray(requestedChildren) || requestedChildren.length > 100 ||
    requestedChildren.some((id) => typeof id !== "string" || !id.trim() || id.trim().length > 120)) {
    throw new HttpError(400, "Некорректный список общих детей.");
  }
  const sharedChildIds = [...new Set(requestedChildren.map((id) => id.trim()))];
  if (sharedChildIds.length) {
    if (!relativePerson || input.relationshipKind !== "spouse") {
      throw new HttpError(400, "Общих детей можно указать только при добавлении супруга или супруги.");
    }
    const candidates = new Set(getSharedChildrenCandidates(family, relativePerson.id).map((child) => child.id));
    if (sharedChildIds.some((id) => !candidates.has(id))) {
      throw new HttpError(400, "Выберите существующих детей указанного родственника, у которых ещё не указаны двое родителей.");
    }
  }

  const normalizedInput: AddPersonInput = {
    ...input,
    firstName: normalizeText(input.firstName),
    lastName: normalizeText(input.lastName),
    middleName: normalizeText(input.middleName ?? ""),
    birthDate: normalizeText(input.birthDate),
    birthPlace: normalizeText(input.birthPlace),
    biography: normalizeMultilineText(input.biography ?? ""),
  };

  const nextPerson: FamilyPerson = {
    id: makePersonId(family, normalizedInput),
    firstName: normalizedInput.firstName,
    lastName: normalizedInput.lastName,
    middleName: normalizedInput.middleName || undefined,
    gender: normalizedInput.gender,
    birthDate: normalizedInput.birthDate,
    birthPlace: normalizedInput.birthPlace,
    status: normalizedInput.status ?? "living",
    deathDate: normalizedInput.status === "deceased"
      ? normalizeText(normalizedInput.deathDate ?? "") || undefined
      : undefined,
    isArchived: false,
    biography:
      normalizedInput.biography ||
      `${personDisplayNameForTimeline(normalizedInput)} добавлен(а) в семейное дерево. Биография будет заполнена позже.`,
    note: "Карточка создана в MVP через форму добавления человека.",
    timeline: buildPersonTimeline({ ...normalizedInput, status: normalizedInput.status ?? "living" }, createPersonTimelineEvents()),
    media: { photos: 0, audio: 0, documents: 0 },
    mediaAssets: [],
    stories: [],
  };

  let stagedFamily = { ...family, people: [...family.people, nextPerson] };
  for (const link of explicitLinks) {
    // Keep the historical spouse orientation and stage all explicit links first.
    stagedFamily = link.relationshipKind === "spouse"
      ? addRelationshipToFamily(stagedFamily, link.relativePersonId, { relationshipKind: "spouse", relativePersonId: nextPerson.id }).family
      : addRelationshipToFamily(stagedFamily, nextPerson.id, link).family;
  }
  for (const childId of sharedChildIds) {
    stagedFamily = addRelationshipToFamily(stagedFamily, nextPerson.id, { relationshipKind: "parent", relativePersonId: childId }).family;
  }
  const inferred = options.deferInference ? { family: stagedFamily, warnings: [] }
    : applyAutomaticParenthood(stagedFamily, stagedFamily.relationships.slice(family.relationships.length));

  const nextFamily: Family = {
    ...family,
    stats: {
      ...family.stats,
      people: family.stats.people + 1,
    },
    people: [...family.people, nextPerson],
    archivedPeople: family.archivedPeople,
    relationships: inferred.family.relationships,
    auditLog: family.auditLog,
  };

  return { family: nextFamily, person: nextPerson, warnings: inferred.warnings };
}
