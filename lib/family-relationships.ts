import { HttpError } from "@/lib/http-error";
import type { FamilyPerson, FamilyRelationship } from "@/lib/types";

export type AddExistingRelationshipInput = {
  relativePersonId: string;
  // The selected person has this role relative to relativePersonId.
  relationshipKind: "parent" | "child" | "spouse" | "sibling";
};

export type RelationshipFamily = {
  people: Pick<FamilyPerson, "id" | "isArchived">[];
  relationships: FamilyRelationship[];
  parentSuppressions?: { fromPersonId: string; toPersonId: string }[];
};

export function parseAddExistingRelationshipInput(data: unknown): AddExistingRelationshipInput {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError(400, "Некорректные данные родственной связи.");
  }

  const payload = data as Record<string, unknown>;
  if (
    typeof payload.relativePersonId !== "string" ||
    !payload.relativePersonId.trim() ||
    payload.relativePersonId.trim().length > 120
  ) {
    throw new HttpError(400, "Выберите человека из этого дерева.");
  }
  if (payload.relationshipKind !== "parent" && payload.relationshipKind !== "child" && payload.relationshipKind !== "spouse" && payload.relationshipKind !== "sibling") {
    throw new HttpError(400, "Некорректный тип родственной связи.");
  }

  return {
    relativePersonId: payload.relativePersonId.trim(),
    relationshipKind: payload.relationshipKind,
  };
}

function parentChildren(relationships: FamilyRelationship[]) {
  const children = new Map<string, string[]>();
  for (const relationship of relationships) {
    if (relationship.type !== "parent") continue;
    const childIds = children.get(relationship.fromPersonId) ?? [];
    childIds.push(relationship.toPersonId);
    children.set(relationship.fromPersonId, childIds);
  }
  return children;
}

function hasParentPath(children: ReadonlyMap<string, string[]>, startId: string, targetId: string) {
  const pending = [startId];
  const visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === targetId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return false;
}

export function addRelationshipToFamily<T extends RelationshipFamily>(
  family: T,
  personId: string,
  rawInput: AddExistingRelationshipInput,
): { family: T; relationship: FamilyRelationship; created: boolean } {
  const input = parseAddExistingRelationshipInput(rawInput);
  const activePeople = new Set(family.people.filter((person) => !person.isArchived).map((person) => person.id));
  if (!activePeople.has(personId) || !activePeople.has(input.relativePersonId)) {
    throw new HttpError(404, "Оба человека должны быть в этом дереве и не находиться в архиве.");
  }
  if (personId === input.relativePersonId) {
    throw new HttpError(400, "Нельзя добавить родственную связь человека с самим собой.");
  }

  const relationship: FamilyRelationship = {
    fromPersonId: input.relationshipKind === "child" ? input.relativePersonId : personId,
    toPersonId: input.relationshipKind === "child" ? personId : input.relativePersonId,
    type: input.relationshipKind === "spouse" || input.relationshipKind === "sibling" ? input.relationshipKind : "parent",
  };
  const matchesPair = (current: FamilyRelationship) =>
    (current.fromPersonId === relationship.fromPersonId && current.toPersonId === relationship.toPersonId) ||
    (current.fromPersonId === relationship.toPersonId && current.toPersonId === relationship.fromPersonId);
  const existing = family.relationships.find((current) =>
    current.type === relationship.type && (
      relationship.type !== "parent" ? matchesPair(current) :
        current.fromPersonId === relationship.fromPersonId && current.toPersonId === relationship.toPersonId
    ),
  );
  if (existing) return { family, relationship: existing, created: false };

  if (family.relationships.some((current) => current.type !== relationship.type && matchesPair(current))) {
    throw new HttpError(400, "Между этими людьми уже указана несовместимая родственная связь.");
  }
  // Reuse adjacency within this validation only; do not cache across calls,
  // since callers may pass an updated graph with the same array identity.
  const children = parentChildren(family.relationships);
  if (relationship.type === "sibling" && (
    hasParentPath(children, relationship.fromPersonId, relationship.toPersonId) ||
    hasParentPath(children, relationship.toPersonId, relationship.fromPersonId)
  )) {
    throw new HttpError(400, "Предок и потомок не могут быть связаны как брат и сестра.");
  }
  if (relationship.type === "parent") {
    if (hasParentPath(children, relationship.toPersonId, relationship.fromPersonId)) {
      throw new HttpError(400, "Эта связь создаст цикл: человек не может быть своим предком.");
    }
    const parentIds = new Set(family.relationships
      .filter((current) => current.type === "parent" && current.toPersonId === relationship.toPersonId)
      .map((current) => current.fromPersonId));
    if (parentIds.size >= 2) {
      throw new HttpError(400, "У этого человека уже указаны два родителя.");
    }
    // Validate in both insertion orders: a later parent edge must not turn
    // recorded siblings into ancestors, including through intermediate people.
    const createsSiblingAncestry = family.relationships.some((current) =>
      current.type === "sibling" && (
        (hasParentPath(children, current.fromPersonId, relationship.fromPersonId) &&
          hasParentPath(children, relationship.toPersonId, current.toPersonId)) ||
        (hasParentPath(children, current.toPersonId, relationship.fromPersonId) &&
          hasParentPath(children, relationship.toPersonId, current.fromPersonId))
      ),
    );
    if (createsSiblingAncestry) {
      throw new HttpError(400, "Предок и потомок не могут быть связаны как брат и сестра.");
    }
  }

  return {
    family: { ...family, relationships: [...family.relationships, relationship] },
    relationship,
    created: true,
  };
}
