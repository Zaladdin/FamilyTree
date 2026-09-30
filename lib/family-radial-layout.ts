import type { Family, FamilyRelationship } from "@/lib/types";
import { getFocusRelatives, getRelationLabel, type FamilyTreeLayout, type FamilyTreeLayoutNode } from "@/lib/family-utils";

const NODE_SIZE = 188;
const CONTEXT_SIZE = 124;
const SLOT_GAP = 244;
const RING_GAP = 272;
const MARGIN = 150;
const TAU = Math.PI * 2;

export type FamilyRadialLayout = FamilyTreeLayout & {
  centerPersonId: string | null;
  /** Visual capacity bands, not generations or degrees of kinship. */
  rings: Array<{ level: number; radius: number }>;
};

type Point = { x: number; y: number };
type Curve = { start: Point; control: Point; end: Point };

function compareIds(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function relationshipKey(edge: FamilyRelationship) {
  const pair = [edge.fromPersonId, edge.toPersonId];
  return `${edge.type}:${JSON.stringify(edge.type === "parent" ? pair : pair.sort(compareIds))}`;
}

function circleBorder(center: Point, toward: Point, radius: number): Point {
  const length = Math.hypot(toward.x - center.x, toward.y - center.y) || 1;
  return { x: center.x + (toward.x - center.x) * radius / length, y: center.y + (toward.y - center.y) * radius / length };
}

function clipCurve(source: FamilyTreeLayoutNode, target: FamilyTreeLayoutNode, control: Point, fullSize = false): Curve {
  return {
    start: circleBorder(source, control, (fullSize ? NODE_SIZE : source.size ?? NODE_SIZE) / 2),
    control,
    end: circleBorder(target, control, (fullSize ? NODE_SIZE : target.size ?? NODE_SIZE) / 2),
  };
}

function curvePoint(curve: Curve, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * curve.start.x + 2 * u * t * curve.control.x + t * t * curve.end.x,
    y: u * u * curve.start.y + 2 * u * t * curve.control.y + t * t * curve.end.y,
  };
}

function curveExtent(curve: Curve) {
  let extent = Math.max(Math.abs(curve.start.x), Math.abs(curve.start.y), Math.abs(curve.end.x), Math.abs(curve.end.y));
  for (const axis of ["x", "y"] as const) {
    const denominator = curve.start[axis] - 2 * curve.control[axis] + curve.end[axis];
    if (!denominator) continue;
    const t = (curve.start[axis] - curve.control[axis]) / denominator;
    if (t > 0 && t < 1) extent = Math.max(extent, Math.abs(curvePoint(curve, t)[axis]));
  }
  return extent;
}

/** Read-only spatial lookup keeps curve routing local even for wide families. */
function obstacleGrid(nodes: FamilyTreeLayoutNode[]) {
  const cells = new Map<string, FamilyTreeLayoutNode[]>();
  for (const node of nodes) {
    const key = `${Math.floor(node.x / SLOT_GAP)},${Math.floor(node.y / SLOT_GAP)}`;
    const bucket = cells.get(key) ?? [];
    bucket.push(node);
    cells.set(key, bucket);
  }
  return (point: Point) => {
    const x = Math.floor(point.x / SLOT_GAP);
    const y = Math.floor(point.y / SLOT_GAP);
    const nearby: FamilyTreeLayoutNode[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) nearby.push(...(cells.get(`${x + dx},${y + dy}`) ?? []));
    }
    return nearby;
  };
}

/** Favor the gentlest clear curve; non-planar graphs may still cross other edges.
 * Route against full-size circles so toggling context size never shifts the tree. */
function curveControl(source: FamilyTreeLayoutNode, target: FamilyTreeLayoutNode, nearby: ReturnType<typeof obstacleGrid>): Point {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  const middle = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 };
  const normal = { x: -dy / length, y: dx / length };
  const softBend = Math.min(36, length * 0.08);
  const bends = [softBend, -softBend, length * 0.3, -length * 0.3, length * 0.65, -length * 0.65, length * 1.2, -length * 1.2, length * 2, -length * 2];
  let best = middle;
  let bestPenalty = Number.POSITIVE_INFINITY;
  const steps = Math.min(160, Math.max(32, Math.ceil(length / 12)));
  for (const bend of bends) {
    const control = { x: middle.x + normal.x * bend, y: middle.y + normal.y * bend };
    const curve = clipCurve(source, target, control, true);
    let penalty = 0;
    for (let step = 1; step < steps; step += 1) {
      const point = curvePoint(curve, step / steps);
      for (const node of nearby(point)) {
        if (node === source || node === target) continue;
        penalty += Math.max(0, NODE_SIZE / 2 + 12 - Math.hypot(point.x - node.x, point.y - node.y));
      }
      if (penalty >= bestPenalty) break;
    }
    if (penalty < bestPenalty) {
      best = control;
      bestPenalty = penalty;
    }
    if (!penalty) break;
  }
  return best;
}

/** A circular graph view: selection is the center, not a new recorded relation.
 * No generation ordering is implied, including for marriages and ancestry cycles. */
export function buildFamilyRadialLayout(family: Family, focusPersonId: string | null, compactOthers = true): FamilyRadialLayout {
  const people = [...new Map(family.people.map((person) => [person.id, person])).values()].sort((a, b) => compareIds(a.id, b.id));
  if (!people.length) return { nodes: [], links: [], width: 0, height: 0, nodeSize: NODE_SIZE, centerPersonId: null, rings: [] };
  const ids = people.map((person) => person.id);
  const validIds = new Set(ids);
  const uniqueEdges = new Map<string, FamilyRelationship>();
  for (const edge of family.relationships) {
    if (!validIds.has(edge.fromPersonId) || !validIds.has(edge.toPersonId) || edge.fromPersonId === edge.toPersonId) continue;
    if (edge.type !== "parent" && edge.type !== "spouse" && edge.type !== "sibling") continue;
    const key = relationshipKey(edge);
    // Symmetric facts use canonical direction for input-order independent paths.
    const [fromPersonId, toPersonId] = edge.type === "parent" ? [edge.fromPersonId, edge.toPersonId] : [edge.fromPersonId, edge.toPersonId].sort(compareIds);
    uniqueEdges.set(key, { type: edge.type, fromPersonId, toPersonId });
  }
  const relationships = [...uniqueEdges.entries()].sort(([a], [b]) => compareIds(a, b));
  const adjacency = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const [, edge] of relationships) {
    adjacency.get(edge.fromPersonId)!.add(edge.toPersonId);
    adjacency.get(edge.toPersonId)!.add(edge.fromPersonId);
  }
  const sortedNeighbors = new Map(ids.map((id) => [id, [...adjacency.get(id)!].sort(compareIds)]));
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const id of ids) {
    if (visited.has(id)) continue;
    const members = [id];
    visited.add(id);
    for (let i = 0; i < members.length; i += 1) {
      for (const next of sortedNeighbors.get(members[i])!) {
        if (!visited.has(next)) {
          visited.add(next);
          members.push(next);
        }
      }
    }
    members.sort((a, b) => adjacency.get(b)!.size - adjacency.get(a)!.size || compareIds(a, b));
    components.push(members);
  }
  components.sort((a, b) => b.length - a.length || compareIds(a[0], b[0]));
  const focus = people.find((person) => person.id === focusPersonId);
  const centerPersonId = focus?.id ?? components[0][0];
  const levelOf = new Map<string, number>();
  const branchOf = new Map<string, number>();
  let branchCount = 0;
  function walk(rootId: string, startLevel: number) {
    const queue = [rootId];
    levelOf.set(rootId, startLevel);
    branchOf.set(rootId, branchCount++);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      for (const next of sortedNeighbors.get(current)!) {
        if (levelOf.has(next)) continue;
        levelOf.set(next, levelOf.get(current)! + 1);
        branchOf.set(next, current === centerPersonId ? branchCount++ : branchOf.get(current)!);
        queue.push(next);
      }
    }
  }
  walk(centerPersonId, 0);
  const outerStart = Math.max(...levelOf.values()) + 1;
  for (const component of components) {
    if (!levelOf.has(component[0])) walk(component[0], outerStart);
  }

  // Graph distance orders people but must not create sparse one-person orbits.
  // Small families use a single full circle; larger families balance population
  // across capacity bands of 12, 24, 36... to keep the outside visibly circular.
  const ordered = ids.filter((id) => id !== centerPersonId)
    .sort((a, b) => levelOf.get(a)! - levelOf.get(b)! || branchOf.get(a)! - branchOf.get(b)! || compareIds(a, b));
  let ringCount = ordered.length ? 1 : 0;
  while (6 * ringCount * (ringCount + 1) < ordered.length) ringCount += 1;
  let remainingWeight = ringCount * (ringCount + 1) / 2;
  let offset = 0;
  const positions = new Map<string, Point>([[centerPersonId, { x: 0, y: 0 }]]);
  const rings: FamilyRadialLayout["rings"] = [];
  let previousRadius = 0;
  for (let level = 1; level <= ringCount; level += 1) {
    const remaining = ordered.length - offset;
    const count = level === ringCount ? remaining : Math.round(remaining * level / remainingWeight);
    const members = ordered.slice(offset, offset + count);
    offset += count;
    remainingWeight -= level;
    members.sort((a, b) => branchOf.get(a)! - branchOf.get(b)! || compareIds(a, b));
    const radius = Math.max(previousRadius + RING_GAP, count > 1 ? SLOT_GAP / (2 * Math.sin(Math.PI / count)) : RING_GAP);
    rings.push({ level, radius });
    members.forEach((id, index) => {
      const angle = -Math.PI / 2 + TAU * index / count;
      positions.set(id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    });
    previousRadius = radius;
  }

  const nearbyIds = new Set<string>(focus && compactOthers ? [focus.id] : ids);
  const roles = new Map<string, string>();
  if (focus) {
    const relatives = getFocusRelatives({ ...family, people, relationships: relationships.map(([, edge]) => edge) }, focus.id);
    for (const [kind, relativesOfKind] of [["parent", relatives.parents], ["spouse", relatives.spouses], ["child", relatives.children], ["sibling", relatives.siblings]] as const) {
      for (const relative of relativesOfKind) {
        nearbyIds.add(relative.id);
        if (!roles.has(relative.id)) roles.set(relative.id, getRelationLabel(kind, relative));
      }
    }
  }
  const nodes: FamilyTreeLayoutNode[] = people.map((person) => ({
    person, ...positions.get(person.id)!,
    role: person.id === focus?.id ? "" : roles.get(person.id) ?? "",
    isFocus: person.id === focus?.id,
    isContext: !nearbyIds.has(person.id),
    size: nearbyIds.has(person.id) ? NODE_SIZE : CONTEXT_SIZE,
  }));
  const nodeById = new Map(nodes.map((node) => [node.person.id, node]));
  const nearby = obstacleGrid(nodes);
  const curves = relationships.map(([key, edge]) => {
    const source = nodeById.get(edge.fromPersonId)!;
    const target = nodeById.get(edge.toPersonId)!;
    return { key, type: edge.type, source, target, control: curveControl(source, target, nearby) };
  });
  // Control handles are not visible: using their hull can shrink a small family
  // to fit a huge empty canvas. Exact curve extrema preserve the 150px margin.
  // Reserve every compact/full endpoint combination to keep sizing-only toggles
  // stable without clipping the slightly different endpoint curves.
  let extent = previousRadius + NODE_SIZE / 2;
  for (const { source, target, control } of curves) {
    for (const sourceSize of [NODE_SIZE, CONTEXT_SIZE]) {
      for (const targetSize of [NODE_SIZE, CONTEXT_SIZE]) {
        extent = Math.max(extent, curveExtent(clipCurve({ ...source, size: sourceSize }, { ...target, size: targetSize }, control)) + 0.001);
      }
    }
  }
  const center = extent + MARGIN;
  const translate = (point: Point) => ({ x: point.x + center, y: point.y + center });
  const number = (value: number) => Number(value.toFixed(4));
  const pair = (point: Point) => `${number(point.x)} ${number(point.y)}`;
  return {
    nodes: nodes.map((node) => ({ ...node, ...translate(node) })),
    links: curves.map(({ key, type, source, target, control }) => {
      const curve = clipCurve(source, target, control);
      return { key, type, relationshipKeys: [key], d: `M ${pair(translate(curve.start))} Q ${pair(translate(control))} ${pair(translate(curve.end))}` };
    }),
    width: center * 2,
    height: center * 2,
    nodeSize: NODE_SIZE,
    centerPersonId,
    rings,
  };
}
