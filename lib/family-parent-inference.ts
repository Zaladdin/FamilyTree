import { addRelationshipToFamily, type RelationshipFamily } from "@/lib/family-relationships";
import { HttpError } from "@/lib/http-error";
import type { FamilyRelationship } from "@/lib/types";

export type ParentInferenceWarning = { parentId: string; childId: string; message: string };

type ParentCandidate = FamilyRelationship & { type: "parent"; origin: "spouse" | "sibling"; sourcePersonId: string };

const parentKey = (parentId: string, childId: string) => JSON.stringify([parentId, childId]);
const relationshipKey = (edge: FamilyRelationship) => `${edge.type}:${JSON.stringify(edge.type === "parent"
  ? [edge.fromPersonId, edge.toPersonId] : [edge.fromPersonId, edge.toPersonId].sort())}`;

/** Apply only consequences of the current operation; existing unrelated branches are not backfilled. */
export function applyAutomaticParenthood<T extends RelationshipFamily>(
  family: T,
  seeds: FamilyRelationship[],
): { family: T; warnings: ParentInferenceWarning[] } {
  const blockedChildren = new Set<string>();
  const blockedPairs = new Set<string>();
  const blockedWarnings = new Map<string, ParentInferenceWarning>();
  // Every retry blocks at least one new child or directed pair, so the finite
  // graph bounds retries. Rebuild from the original graph to drop consequences
  // of rejected provisional parents without touching any previously saved edge.
  for (;;) {
    const planned = planAutomaticParents(family, seeds, blockedChildren, blockedPairs);
    if (planned.block) {
      if (planned.block.childId) blockedChildren.add(planned.block.childId);
      for (const candidate of planned.block.candidates) {
        const key = parentKey(candidate.fromPersonId, candidate.toPersonId);
        if (!planned.block.childId) blockedPairs.add(key);
        blockedWarnings.set(key, { parentId: candidate.fromPersonId, childId: candidate.toPersonId, message: planned.block.message });
      }
      continue;
    }
    const warnings = new Map([...blockedWarnings.values(), ...planned.warnings].map((warning) =>
      [JSON.stringify([warning.parentId, warning.childId, warning.message]), warning]));
    return { family: planned.family, warnings: [...warnings.values()].sort((left, right) =>
      JSON.stringify([left.childId, left.parentId, left.message]).localeCompare(JSON.stringify([right.childId, right.parentId, right.message]))) };
  }
}

type PlanBlock = { childId?: string; candidates: ParentCandidate[]; message: string };
const ambiguityMessage = "Автоматический выбор родителей неоднозначен: укажите нужную связь вручную.";
const conflictMessage = "Автоматические связи несовместимы друг с другом: укажите нужную связь вручную.";

function planAutomaticParents<T extends RelationshipFamily>(
  family: T,
  seeds: FamilyRelationship[],
  blockedChildren: Set<string>,
  blockedPairs: Set<string>,
): { family: T; warnings: ParentInferenceWarning[]; block?: PlanBlock } {
  let nextFamily = family;
  const warnings = new Map<string, ParentInferenceWarning>();
  const visited = new Set<string>();
  const consideredByChild = new Map<string, Map<string, ParentCandidate>>();
  const addedParents: ParentCandidate[] = [];
  const suppressed = new Set((family.parentSuppressions ?? []).map((edge) => parentKey(edge.fromPersonId, edge.toPersonId)));
  const recorded = new Set(family.relationships.map(relationshipKey));
  let pending = seeds.filter((edge) => recorded.has(relationshipKey(edge)));
  const warn = (parentId: string, childId: string, message: string) => {
    warnings.set(JSON.stringify([parentId, childId, message]), { parentId, childId, message });
  };
  const validate = (graph: T, candidate: ParentCandidate) => addRelationshipToFamily(graph, candidate.fromPersonId,
    { relationshipKind: "parent", relativePersonId: candidate.toPersonId });
  const conflictsWith = (candidate: ParentCandidate, additions: ParentCandidate[]) => {
    try {
      validate({ ...family, relationships: [...family.relationships, ...additions] }, candidate);
      return false;
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      return true;
    }
  };
  const jointConflict = (candidate: ParentCandidate): PlanBlock => {
    // Find a minimal set of provisional edges responsible for a joint cycle or
    // sibling ancestry conflict, retaining unrelated successful branches.
    let involved = [...addedParents];
    for (const edge of addedParents) {
      const remaining = involved.filter((current) => current !== edge);
      if (conflictsWith(candidate, remaining)) involved = remaining;
    }
    return { candidates: [...involved, candidate], message: conflictMessage };
  };

  while (pending.length) {
    const candidates = new Map<string, ParentCandidate>();
    const parents = (childId: string) => new Set(nextFamily.relationships
      .filter((edge) => edge.type === "parent" && edge.toPersonId === childId).map((edge) => edge.fromPersonId));
    const peers = (personId: string, type: "spouse" | "sibling") => [...new Set(nextFamily.relationships
      .filter((edge) => edge.type === type && (edge.fromPersonId === personId || edge.toPersonId === personId))
      .map((edge) => edge.fromPersonId === personId ? edge.toPersonId : edge.fromPersonId))].sort();
    const propose = (parentId: string, childId: string, origin: ParentCandidate["origin"], sourcePersonId: string) => {
      const key = parentKey(parentId, childId);
      if (suppressed.has(key) || parents(childId).has(parentId)) return;
      if (blockedChildren.has(childId)) {
        warn(parentId, childId, ambiguityMessage);
        return;
      }
      if (blockedPairs.has(key)) {
        warn(parentId, childId, conflictMessage);
        return;
      }
      const candidate: ParentCandidate = { type: "parent", fromPersonId: parentId, toPersonId: childId, origin, sourcePersonId };
      const previous = candidates.get(key);
      // Multiple valid witnesses yield one edge and stable provenance independent of seed order.
      if (!previous || JSON.stringify([origin, sourcePersonId]) < JSON.stringify([previous.origin, previous.sourcePersonId])) {
        candidates.set(key, candidate);
      }
    };
    const spouseParents = (parentId: string, childId: string) => {
      const spouses = peers(parentId, "spouse");
      if (spouses.length === 1) {
        propose(spouses[0], childId, "spouse", parentId);
      } else if (spouses.length > 1) {
        for (const spouseId of spouses) {
          if (!parents(childId).has(spouseId) && !suppressed.has(parentKey(spouseId, childId))) {
            warn(spouseId, childId, "У родителя несколько супругов: выберите второго родителя вручную.");
          }
        }
      }
    };
    for (const seed of pending) {
      const key = relationshipKey(seed);
      if (visited.has(key)) continue;
      visited.add(key);
      if (seed.type === "parent") {
        spouseParents(seed.fromPersonId, seed.toPersonId);
        for (const siblingId of peers(seed.toPersonId, "sibling")) propose(seed.fromPersonId, siblingId, "sibling", seed.toPersonId);
      } else if (seed.type === "spouse") {
        for (const parentId of [seed.fromPersonId, seed.toPersonId]) {
          for (const edge of nextFamily.relationships) {
            if (edge.type === "parent" && edge.fromPersonId === parentId) spouseParents(parentId, edge.toPersonId);
          }
        }
      } else {
        for (const [sourceId, childId] of [[seed.fromPersonId, seed.toPersonId], [seed.toPersonId, seed.fromPersonId]]) {
          for (const parentId of parents(sourceId)) propose(parentId, childId, "sibling", sourceId);
        }
      }
    }

    const eligibleByChild = new Map<string, ParentCandidate[]>();
    for (const candidate of candidates.values()) {
      try {
        // Separate intrinsic invalidity from conflicts with provisional parents.
        // The original graph includes every explicit choice and archived edge.
        validate(family, candidate);
        const considered = consideredByChild.get(candidate.toPersonId) ?? new Map<string, ParentCandidate>();
        considered.set(candidate.fromPersonId, candidate);
        consideredByChild.set(candidate.toPersonId, considered);
        const group = eligibleByChild.get(candidate.toPersonId) ?? [];
        group.push(candidate);
        eligibleByChild.set(candidate.toPersonId, group);
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        warn(candidate.fromPersonId, candidate.toPersonId, error.message);
      }
    }
    // Only children with a newly discovered candidate can overflow this round.
    // Rescanning the full registry for every single-edge wave becomes cubic.
    for (const childId of [...eligibleByChild.keys()].sort((left, right) => left.localeCompare(right))) {
      const considered = consideredByChild.get(childId)!;
      const originalParents = new Set(family.relationships.filter((edge) => edge.type === "parent" && edge.toPersonId === childId)
        .map((edge) => edge.fromPersonId));
      if (considered.size > 2 - originalParents.size) {
        return { family, warnings: [], block: { childId, candidates: [...considered.values()], message: ambiguityMessage } };
      }
    }
    pending = [];
    for (const [, group] of [...eligibleByChild].sort(([left], [right]) => left.localeCompare(right))) {
      for (const candidate of group.sort((left, right) => left.fromPersonId.localeCompare(right.fromPersonId))) {
        try {
          const added = validate(nextFamily, candidate);
          if (!added.created) continue;
          nextFamily = { ...added.family, relationships: [...nextFamily.relationships, candidate] };
          addedParents.push(candidate);
          pending.push(candidate);
        } catch (error) {
          if (!(error instanceof HttpError)) throw error;
          return { family, warnings: [], block: jointConflict(candidate) };
        }
      }
    }
  }
  return { family: nextFamily, warnings: [...warnings.values()] };
}

export function formatParentInferenceWarnings(
  warnings: ParentInferenceWarning[],
  people: { id: string; firstName: string; lastName: string; middleName?: string }[],
): string[] {
  const names = new Map(people.map((person) => [person.id, [person.firstName, person.middleName, person.lastName].filter(Boolean).join(" ")]));
  return warnings.map(({ parentId, childId, message }) =>
    `${names.get(parentId) ?? "Родитель"} → ${names.get(childId) ?? "Ребёнок"}: ${message}`);
}
