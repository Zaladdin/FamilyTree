import type { Family } from "@/lib/types";

const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Relative generations, independent of selection and the depth of known roots.
 * A weighted forest joins parental branches with the required offset instead of
 * assuming that every person with unknown parents belongs to the oldest row.
 * Contradictory cycles cannot satisfy every constraint: recorded parent edges
 * take priority over peer alignment, and a stable first constraint wins. This
 * affects coordinates only; callers still render every recorded relationship.
 */
export function buildFamilyGenerationRanks(family: Pick<Family, "people" | "relationships">): Map<string, number> {
  const ids = [...new Set(family.people.map((person) => person.id))].sort(compareIds);
  const roots = new Map(ids.map((id) => [id, id]));
  const offsets = new Map(ids.map((id) => [id, 0]));
  const sizes = new Map(ids.map((id) => [id, 1]));
  // Iterative traversal with union by size bounds the forest depth without a
  // recursive call stack, even for long ancestry chains.
  const locate = (id: string) => {
    let offset = 0;
    while (roots.get(id)! !== id) {
      offset += offsets.get(id)!;
      id = roots.get(id)!;
    }
    return { root: id, offset };
  };
  const constraints = family.relationships
    .filter((edge) => roots.has(edge.fromPersonId) && roots.has(edge.toPersonId) && edge.fromPersonId !== edge.toPersonId
      && (edge.type === "parent" || edge.type === "spouse" || edge.type === "sibling"))
    .map((edge) => {
      const [from, to] = edge.type === "parent"
        ? [edge.fromPersonId, edge.toPersonId]
        : [edge.fromPersonId, edge.toPersonId].sort(compareIds);
      return { from, to, delta: edge.type === "parent" ? 1 : 0 };
    })
    .sort((a, b) => b.delta - a.delta || compareIds(a.from, b.from) || compareIds(a.to, b.to));
  for (const { from, to, delta } of constraints) {
    const a = locate(from);
    const b = locate(to);
    if (a.root === b.root) continue;
    const difference = delta + a.offset - b.offset;
    if (sizes.get(a.root)! >= sizes.get(b.root)!) {
      roots.set(b.root, a.root);
      offsets.set(b.root, difference);
      sizes.set(a.root, sizes.get(a.root)! + sizes.get(b.root)!);
    } else {
      roots.set(a.root, b.root);
      offsets.set(a.root, -difference);
      sizes.set(b.root, sizes.get(a.root)! + sizes.get(b.root)!);
    }
  }
  const positions = new Map(ids.map((id) => [id, locate(id)]));
  const minima = new Map<string, number>();
  for (const { root, offset } of positions.values()) minima.set(root, Math.min(minima.get(root) ?? offset, offset));
  return new Map(ids.map((id) => {
    const { root, offset } = positions.get(id)!;
    return [id, offset - minima.get(root)!];
  }));
}
