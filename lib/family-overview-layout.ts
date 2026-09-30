import type { Family } from "@/lib/types";
import {
  getFocusRelatives,
  getRelationLabel,
  type FamilyTreeLayout,
  type FamilyTreeLayoutNode,
} from "@/lib/family-utils";

const NODE_SIZE = 188;
const CONTEXT_SIZE = 124;
const COL_GAP = 244;
const MIN_ROW_GAP = 290;
const MARGIN = 150;

function disjointSets(ids: string[]) {
  const roots = new Map(ids.map((id) => [id, id]));
  function find(id: string): string {
    let root = id;
    while (roots.get(root) !== root) root = roots.get(root)!;
    while (roots.get(id) !== root) {
      const next = roots.get(id)!;
      roots.set(id, root);
      id = next;
    }
    return root;
  }
  function union(first: string, second: string) {
    const a = find(first);
    const b = find(second);
    if (a !== b) roots.set(b, a);
  }
  return { find, union };
}

// Iterative Kosaraju traversal: even malformed ancestry cycles terminate, without
// a recursive call stack or an unbounded "move child down one generation" loop.
function stronglyConnectedGroups(ids: string[], edges: Map<string, Set<string>>) {
  const reverse = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const [from, targets] of edges) {
    for (const to of targets) reverse.get(to)!.add(from);
  }
  const visited = new Set<string>();
  const finished: string[] = [];
  for (const id of ids) {
    if (visited.has(id)) continue;
    const stack: Array<{ id: string; finish: boolean }> = [{ id, finish: false }];
    while (stack.length) {
      const item = stack.pop()!;
      if (item.finish) {
        finished.push(item.id);
        continue;
      }
      if (visited.has(item.id)) continue;
      visited.add(item.id);
      stack.push({ id: item.id, finish: true });
      for (const next of edges.get(item.id) ?? []) {
        if (!visited.has(next)) stack.push({ id: next, finish: false });
      }
    }
  }
  const groupOf = new Map<string, number>();
  let count = 0;
  for (const id of finished.reverse()) {
    if (groupOf.has(id)) continue;
    const stack = [id];
    groupOf.set(id, count);
    while (stack.length) {
      for (const next of reverse.get(stack.pop()!) ?? []) {
        if (!groupOf.has(next)) {
          groupOf.set(next, count);
          stack.push(next);
        }
      }
    }
    count += 1;
  }
  return { groupOf, count };
}

/**
 * The overview uses fixed 188px slots for every person. Selecting a person changes
 * emphasis and the exact edge endpoints, never the coordinates or canvas size.
 * null explicitly removes selection and displays all cards at their natural size.
 */
export function buildFamilyOverviewLayout(family: Family, focusPersonId: string | null): FamilyTreeLayout {
  const people = [...new Map(family.people.map((person) => [person.id, person])).values()];
  if (!people.length) return { nodes: [], links: [], width: 0, height: 0, nodeSize: NODE_SIZE };

  const ids = people.map((person) => person.id);
  const validIds = new Set(ids);
  const seenRelationships = new Set<string>();
  const relationships = family.relationships.filter((relationship) => {
    const { fromPersonId: from, toPersonId: to, type } = relationship;
    if (!validIds.has(from) || !validIds.has(to) || from === to) return false;
    const pair = type === "parent" ? [from, to] : [from, to].sort();
    const key = `${type}:${JSON.stringify(pair)}`;
    if (seenRelationships.has(key)) return false;
    seenRelationships.add(key);
    return true;
  });
  const parentIdsByChild = new Map<string, string[]>();
  for (const relationship of relationships) {
    if (relationship.type !== "parent") continue;
    const parents = parentIdsByChild.get(relationship.toPersonId) ?? [];
    parents.push(relationship.fromPersonId);
    parentIdsByChild.set(relationship.toPersonId, parents);
  }
  const parentSetKey = (childId: string) => JSON.stringify([...(parentIdsByChild.get(childId) ?? [])].sort());

  const couples = disjointSets(ids);
  const connected = disjointSets(ids);
  for (const relationship of relationships) {
    connected.union(relationship.fromPersonId, relationship.toPersonId);
    // Siblings share a visual generation, never an inferred parent or spouse.
    if (relationship.type === "spouse" || relationship.type === "sibling") couples.union(relationship.fromPersonId, relationship.toPersonId);
  }
  const coupleMembers = new Map<string, string[]>();
  for (const id of ids) {
    const group = couples.find(id);
    coupleMembers.set(group, [...(coupleMembers.get(group) ?? []), id]);
  }
  const coupleIds = [...coupleMembers.keys()];
  const generationEdges = new Map(coupleIds.map((id) => [id, new Set<string>()]));
  const parentGroups = new Map(coupleIds.map((id) => [id, new Set<string>()]));
  for (const relationship of relationships) {
    if (relationship.type !== "parent") continue;
    const from = couples.find(relationship.fromPersonId);
    const to = couples.find(relationship.toPersonId);
    if (from !== to) {
      generationEdges.get(from)!.add(to);
      parentGroups.get(to)!.add(from);
    }
  }

  const { groupOf, count } = stronglyConnectedGroups(coupleIds, generationEdges);
  const dag = Array.from({ length: count }, () => new Set<number>());
  const indegree = Array<number>(count).fill(0);
  for (const [from, targets] of generationEdges) {
    for (const to of targets) {
      const a = groupOf.get(from)!;
      const b = groupOf.get(to)!;
      if (a !== b && !dag[a].has(b)) {
        dag[a].add(b);
        indegree[b] += 1;
      }
    }
  }
  const generation = Array<number>(count).fill(0);
  const queue = indegree.flatMap((degree, index) => degree === 0 ? [index] : []);
  for (let index = 0; index < queue.length; index += 1) {
    const from = queue[index];
    for (const to of dag[from]) {
      generation[to] = Math.max(generation[to], generation[from] + 1);
      indegree[to] -= 1;
      if (!indegree[to]) queue.push(to);
    }
  }
  const rowOf = (id: string) => generation[groupOf.get(couples.find(id))!];
  const branchSetsByRow = new Map<number, Set<string>>();
  for (const relationship of relationships) {
    if (relationship.type !== "parent" || rowOf(relationship.toPersonId) !== rowOf(relationship.fromPersonId) + 1) continue;
    const row = rowOf(relationship.fromPersonId);
    const sets = branchSetsByRow.get(row) ?? new Set<string>();
    sets.add(parentSetKey(relationship.toPersonId));
    branchSetsByRow.set(row, sets);
  }
  // Reserve space for branch lanes from the graph alone: selecting someone must
  // never change the row spacing, even when surrounding cards become compact.
  const rowY = [MARGIN + NODE_SIZE / 2];
  const lastRow = Math.max(...generation);
  for (let row = 0; row < lastRow; row += 1) {
    const branchCount = branchSetsByRow.get(row)?.size ?? 0;
    rowY.push(rowY[row] + Math.max(MIN_ROW_GAP, NODE_SIZE + 72 + branchCount * 18));
  }

  const components = new Map<string, string[]>();
  for (const group of coupleIds) {
    const component = connected.find(coupleMembers.get(group)![0]);
    components.set(component, [...(components.get(component) ?? []), group]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  const componentBounds = new Map<string, { left: number; right: number }>();
  const groupCenters = new Map<string, number>();
  let componentStartX = MARGIN + NODE_SIZE / 2;
  for (const [component, groups] of components) {
    const rows = new Map<number, string[]>();
    for (const group of groups) {
      const row = generation[groupOf.get(group)!];
      rows.set(row, [...(rows.get(row) ?? []), group]);
    }
    const rowSize = (groupsInRow: string[]) => groupsInRow.reduce((total, group) => total + coupleMembers.get(group)!.length, 0);
    const largestRow = Math.max(...[...rows.values()].map(rowSize));
    const componentWidth = NODE_SIZE + (largestRow - 1) * COL_GAP;
    componentBounds.set(component, { left: componentStartX - NODE_SIZE / 2, right: componentStartX - NODE_SIZE / 2 + componentWidth });
    for (const [row, groupsInRow] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
      const parentCenter = (group: string) => {
        const values = [...parentGroups.get(group)!].flatMap((parent) => groupCenters.has(parent) ? [groupCenters.get(parent)!] : []);
        return values.length ? values.reduce((sum, x) => sum + x, 0) / values.length : componentStartX;
      };
      // Keeping spouse groups together makes multiple marriages visible without
      // letting a different focus reorder or recenter the entire family.
      const ordered = [...groupsInRow].sort((a, b) => parentCenter(a) - parentCenter(b));
      let x = componentStartX + ((largestRow - rowSize(ordered)) * COL_GAP) / 2;
      for (const group of ordered) {
        const ownParentCenter = (id: string) => {
          const values = (parentIdsByChild.get(id) ?? []).flatMap((parent) => positions.has(parent) ? [positions.get(parent)!.x] : []);
          return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : parentCenter(group);
        };
        // A couple joining two families faces its own parental branches. The
        // input order (often birth-date order) is not a meaningful orientation.
        const members = [...coupleMembers.get(group)!].sort((a, b) => ownParentCenter(a) - ownParentCenter(b));
        groupCenters.set(group, x + ((members.length - 1) * COL_GAP) / 2);
        for (const id of members) {
          positions.set(id, { x, y: rowY[row] });
          x += COL_GAP;
        }
      }
    }
    componentStartX += componentWidth + COL_GAP;
  }

  const focus = focusPersonId === null ? undefined : people.find((person) => person.id === focusPersonId) ?? people[0];
  const nearby = new Set<string>(focus ? [focus.id] : ids);
  const roles = new Map<string, string>();
  if (focus) {
    const relatives = getFocusRelatives(family, focus.id);
    for (const [kind, list] of [
      ["parent", relatives.parents], ["spouse", relatives.spouses],
      ["child", relatives.children], ["sibling", relatives.siblings],
    ] as const) {
      for (const person of list) {
        nearby.add(person.id);
        if (!roles.has(person.id)) roles.set(person.id, getRelationLabel(kind, person));
      }
    }
  }
  const nodes: FamilyTreeLayoutNode[] = people.map((person) => ({
    person,
    ...positions.get(person.id)!,
    role: person.id === focus?.id ? "" : roles.get(person.id) ?? "",
    isFocus: person.id === focus?.id,
    isContext: !nearby.has(person.id),
    size: nearby.has(person.id) ? NODE_SIZE : CONTEXT_SIZE,
  }));
  const nodeById = new Map(nodes.map((node) => [node.person.id, node]));
  const edgeKey = (from: string, to: string) => `parent:${JSON.stringify([from, to])}`;
  const links: Array<FamilyTreeLayout["links"][number] & { relationshipKeys: string[] }> = [];
  const coupleJunctions = new Map<string, { x: number; y: number }>();
  const sharedBranches = new Map<string, { parentIds: string[]; childIds: string[]; row: number }>();
  for (const [childId, parents] of parentIdsByChild) {
    const parentIds = [...parents].sort();
    const row = rowOf(parentIds[0]);
    // Only a complete parent set on the immediately preceding row can share a
    // junction. Mixed-generation or cyclic ancestry keeps its individual edges.
    if (rowOf(childId) !== row + 1 || parentIds.some((id) => rowOf(id) !== row)) continue;
    const key = `${row}:${parentSetKey(childId)}`;
    const branch = sharedBranches.get(key) ?? { parentIds, childIds: [], row };
    branch.childIds.push(childId);
    sharedBranches.set(key, branch);
  }
  const groupedEdges = new Set<string>();
  const laneFor = (row: number, childId: string) => {
    const sets = [...branchSetsByRow.get(row)!].sort();
    const laneIndex = sets.indexOf(parentSetKey(childId));
    const gap = rowY[row + 1] - rowY[row];
    return rowY[row] + NODE_SIZE / 2 + 24 + ((gap - NODE_SIZE - 48) * (laneIndex + 1)) / (sets.length + 1);
  };

  // Draw recorded marriages first. Only a direct, unobstructed marriage line
  // can act as a joint descent anchor for that exact pair's recorded children.
  for (const [index, relationship] of relationships.entries()) {
    if (relationship.type !== "spouse") continue;
    const source = nodeById.get(relationship.fromPersonId)!;
    const target = nodeById.get(relationship.toPersonId)!;
    const pairKey = JSON.stringify([source.person.id, target.person.id].sort());
    const key = `spouse:${pairKey}`;
    const laneOffset = NODE_SIZE / 2 + 18 + (index % 6) * 6;
    const [left, right] = source.x < target.x ? [source, target] : [target, source];
    const hasCardBetween = nodes.some((node) => node.y === left.y && node.x > left.x && node.x < right.x);
    const d = hasCardBetween
      ? `M ${left.x} ${left.y - left.size! / 2} V ${left.y - laneOffset} H ${right.x} V ${right.y - right.size! / 2}`
      : `M ${left.x + left.size! / 2} ${left.y} H ${right.x - right.size! / 2}`;
    links.push({ key, d, relationshipKeys: [key] });
    if (!hasCardBetween) coupleJunctions.set(pairKey, { x: (left.x + right.x) / 2, y: left.y });
  }

  for (const [branchKey, branch] of sharedBranches) {
    const parents = branch.parentIds.map((id) => nodeById.get(id)!);
    const children = branch.childIds.map((id) => nodeById.get(id)!).sort((a, b) => a.x - b.x);
    const relationshipKeys = branch.parentIds.flatMap((from) => branch.childIds.map((to) => edgeKey(from, to)));
    relationshipKeys.forEach((key) => groupedEdges.add(key));
    const laneY = laneFor(branch.row, branch.childIds[0]);
    const prefix = `branch:${branchKey}`;
    if (parents.length === 1 && children.length === 1) {
      const [source] = parents;
      const [target] = children;
      links.push({
        key: relationshipKeys[0], relationshipKeys,
        d: `M ${source.x} ${source.y + source.size! / 2} V ${laneY} H ${target.x} V ${target.y - target.size! / 2}`,
      });
      continue;
    }
    const junction = parents.length === 2 ? coupleJunctions.get(JSON.stringify(branch.parentIds)) : undefined;
    const sourceXs: number[] = [];
    if (junction) {
      sourceXs.push(junction.x);
      links.push({ key: `${prefix}:couple`, relationshipKeys, d: `M ${junction.x} ${junction.y} V ${laneY}` });
    } else {
      for (const source of parents) {
        sourceXs.push(source.x);
        links.push({
          key: `${prefix}:parent:${source.person.id}`,
          relationshipKeys: branch.childIds.map((to) => edgeKey(source.person.id, to)),
          d: `M ${source.x} ${source.y + source.size! / 2} V ${laneY}`,
        });
      }
    }
    const branchXs = [...sourceXs, ...children.map((child) => child.x)];
    const left = Math.min(...branchXs);
    const right = Math.max(...branchXs);
    if (left !== right) links.push({ key: `${prefix}:bus`, relationshipKeys, d: `M ${left} ${laneY} H ${right}` });
    for (const child of children) {
      links.push({
        key: `${prefix}:child:${child.person.id}`,
        relationshipKeys: branch.parentIds.map((from) => edgeKey(from, child.person.id)),
        d: `M ${child.x} ${laneY} V ${child.y - child.size! / 2}`,
      });
    }
  }

  for (const [index, relationship] of relationships.entries()) {
    if (relationship.type !== "sibling") continue;
    const [from, to] = [relationship.fromPersonId, relationship.toPersonId].sort();
    const source = nodeById.get(from)!;
    const target = nodeById.get(to)!;
    const key = `sibling:${JSON.stringify([from, to])}`;
    const laneY = source.y + NODE_SIZE / 2 + 18 + (index % 6) * 6;
    // A separate lane distinguishes sibling facts from marriage junctions.
    links.push({ key, type: "sibling", relationshipKeys: [key], d: `M ${source.x} ${source.y + source.size! / 2} V ${laneY} H ${target.x} V ${target.y + target.size! / 2}` });
  }

  for (const [index, relationship] of relationships.entries()) {
    if (relationship.type !== "parent") continue;
    const source = nodeById.get(relationship.fromPersonId)!;
    const target = nodeById.get(relationship.toPersonId)!;
    const sourceRadius = source.size! / 2;
    const targetRadius = target.size! / 2;
    const key = edgeKey(source.person.id, target.person.id);
    if (groupedEdges.has(key)) continue;
    const relationshipKeys = [key];
    const laneOffset = NODE_SIZE / 2 + 18 + (index % 6) * 6;
    if (source.y === target.y) {
      // A cycle cannot satisfy increasing generations. Show its actual edge via
      // a bounded lane below the row instead of repeatedly moving its nodes.
      links.push({ key, relationshipKeys, d: `M ${source.x} ${source.y + sourceRadius} V ${source.y + laneOffset} H ${target.x} V ${target.y + targetRadius}` });
      continue;
    }
    if (rowOf(target.person.id) === rowOf(source.person.id) + 1) {
      const laneY = laneFor(rowOf(source.person.id), target.person.id);
      links.push({ key, relationshipKeys, d: `M ${source.x} ${source.y + sourceRadius} V ${laneY} H ${target.x} V ${target.y - targetRadius}` });
      continue;
    }
    // Skip-generation edges use a rail outside their connected component, so
    // their vertical segment does not run through unrelated intermediate cards.
    const bounds = componentBounds.get(connected.find(source.person.id))!;
    const railOffset = 24 + (index % 8) * 8;
    const railX = target.x < source.x ? bounds.left - railOffset : bounds.right + railOffset;
    const exitY = source.y + NODE_SIZE / 2 + 24;
    const entryY = target.y - NODE_SIZE / 2 - 24;
    links.push({ key, relationshipKeys, d: `M ${source.x} ${source.y + sourceRadius} V ${exitY} H ${railX} V ${entryY} H ${target.x} V ${target.y - targetRadius}` });
  }

  return {
    nodes,
    links,
    nodeSize: NODE_SIZE,
    width: Math.max(...nodes.map((node) => node.x)) + NODE_SIZE / 2 + MARGIN,
    height: Math.max(...nodes.map((node) => node.y)) + NODE_SIZE / 2 + MARGIN,
  };
}
