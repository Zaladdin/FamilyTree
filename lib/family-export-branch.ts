import type { Family } from "@/lib/types";

/** Export perspective is independent of the interactive canvas and its filter.
 * Follow parent edges upwards to roots, then downwards to family branches.
 * Include directly recorded siblings of that branch and their descendants,
 * then partners. Never infer ancestry from sibling or marriage facts. */
export function getFamilyExportBranch(family: Family, focusPersonId: string | null) {
  const people = [...new Map(family.people.filter((person) => !person.isArchived).map((person) => [person.id, person])).values()];
  const ids = new Set(people.map((person) => person.id));
  if (!focusPersonId || !ids.has(focusPersonId)) {
    return { family: { ...family, people: [], relationships: [] }, rootIds: [] as string[], focusPersonId: null };
  }
  const edges = family.relationships.filter((edge) => ids.has(edge.fromPersonId) && ids.has(edge.toPersonId) && edge.fromPersonId !== edge.toPersonId);
  const parents = new Map(people.map((person) => [person.id, new Set<string>()]));
  const children = new Map(people.map((person) => [person.id, new Set<string>()]));
  for (const edge of edges) {
    if (edge.type !== "parent") continue;
    parents.get(edge.toPersonId)!.add(edge.fromPersonId);
    children.get(edge.fromPersonId)!.add(edge.toPersonId);
  }
  function walk(start: Iterable<string>, adjacency: Map<string, Set<string>>) {
    const seen = new Set(start);
    const queue = [...seen];
    for (let index = 0; index < queue.length; index += 1) {
      for (const next of adjacency.get(queue[index]) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return seen;
  }
  const ancestors = walk([focusPersonId], parents);
  const rootIds = [...ancestors].filter((id) => !parents.get(id)!.size).sort();
  // For malformed legacy cycles use the chosen person as a visual starting point;
  // traversal remains bounded and every recorded ancestor stays represented.
  if (!rootIds.length) rootIds.push(focusPersonId);
  const descendants = walk(ancestors, children);
  const siblingStarts = new Set<string>();
  for (const edge of edges) {
    if (edge.type !== "sibling") continue;
    // One hop only: A/B and B/C siblings do not prove that A and C are siblings.
    if (descendants.has(edge.fromPersonId)) siblingStarts.add(edge.toPersonId);
    if (descendants.has(edge.toPersonId)) siblingStarts.add(edge.fromPersonId);
  }
  const branchRelatives = walk([...descendants, ...siblingStarts], children);
  const branchIds = new Set(branchRelatives);
  for (const edge of edges) {
    if (edge.type !== "spouse") continue;
    if (branchRelatives.has(edge.fromPersonId)) branchIds.add(edge.toPersonId);
    if (branchRelatives.has(edge.toPersonId)) branchIds.add(edge.fromPersonId);
  }
  return {
    family: {
      ...family,
      people: people.filter((person) => branchIds.has(person.id)),
      relationships: edges.filter((edge) => branchIds.has(edge.fromPersonId) && branchIds.has(edge.toPersonId)),
    },
    rootIds,
    focusPersonId,
  };
}
