import type { Family, FamilyRelationship } from "@/lib/types";
import { buildFamilyOverviewLayout } from "@/lib/family-overview-layout";
import type { FamilyTreeLayoutNode } from "@/lib/family-utils";
import type { FamilyRadialLayout } from "@/lib/family-radial-layout";

const NODE_SIZE = 188;
const SLOT_GAP = 244;
const TIER_GROWTH = 180;
const MARGIN = 150;

export type FamilyPyramidLayout = FamilyRadialLayout & {
  /** Decorative generation envelope, never a relationship or a placeholder person. */
  pyramidOutline?: string;
  pyramidLevels: Array<{ y: number; halfWidth: number }>;
};

type Point = { x: number; y: number };
const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const pair = (point: Point) => `${Number(point.x.toFixed(4))} ${Number(point.y.toFixed(4))}`;

function edgeKey(edge: FamilyRelationship) {
  const ids = [edge.fromPersonId, edge.toPersonId];
  return `${edge.type}:${JSON.stringify(edge.type === "parent" ? ids : ids.sort(compareIds))}`;
}

function circleBorder(node: FamilyTreeLayoutNode, toward: Point): Point {
  const length = Math.hypot(toward.x - node.x, toward.y - node.y);
  if (!length) return { x: node.x, y: node.y };
  const radius = (node.size ?? NODE_SIZE) / 2;
  return { x: node.x + (toward.x - node.x) * radius / length, y: node.y + (toward.y - node.y) * radius / length };
}

function connection(source: FamilyTreeLayoutNode, target: FamilyTreeLayoutNode, edge: FamilyRelationship, nodes: FamilyTreeLayoutNode[]) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  const control = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 };
  if (source.y === target.y) {
    const between = nodes.some((node) => node.y === source.y && node.x > Math.min(source.x, target.x) && node.x < Math.max(source.x, target.x));
    // Multiple marriages and malformed same-generation ancestry retain their
    // individual facts. A bounded arc gives intervening circles breathing room.
    control.y += (edge.type === "spouse" ? -1 : 1) * (between ? SLOT_GAP : 28);
  } else if (length) {
    const bend = Math.min(32, length * 0.06);
    control.x -= dy / length * bend;
    control.y += dx / length * bend;
  }
  return `M ${pair(circleBorder(source, control))} Q ${pair(control)} ${pair(circleBorder(target, control))}`;
}

/** An optional oldest-to-youngest view. Existing overview logic determines
 * generations and spouse ordering (including bounded cyclic ancestry). Only
 * row spacing changes: selection never promotes a person to another generation.
 */
export function buildFamilyPyramidLayout(family: Family, focusPersonId: string | null, compactOthers = true): FamilyPyramidLayout {
  const people = [...new Map(family.people.map((person) => [person.id, person])).values()].sort((a, b) => compareIds(a.id, b.id));
  if (!people.length) return { nodes: [], links: [], width: 0, height: 0, nodeSize: NODE_SIZE, centerPersonId: null, rings: [], pyramidLevels: [] };
  const validIds = new Set(people.map((person) => person.id));
  const unique = new Map<string, FamilyRelationship>();
  for (const edge of family.relationships) {
    if (!validIds.has(edge.fromPersonId) || !validIds.has(edge.toPersonId) || edge.fromPersonId === edge.toPersonId) continue;
    if (edge.type !== "parent" && edge.type !== "spouse" && edge.type !== "sibling") continue;
    const [fromPersonId, toPersonId] = edge.type === "parent" ? [edge.fromPersonId, edge.toPersonId] : [edge.fromPersonId, edge.toPersonId].sort(compareIds);
    const canonical = { type: edge.type, fromPersonId, toPersonId };
    unique.set(edgeKey(canonical), canonical);
  }
  const relationships = [...unique.entries()].sort(([a], [b]) => compareIds(a, b));
  const focus = people.find((person) => person.id === focusPersonId);
  const overview = buildFamilyOverviewLayout({ ...family, people, relationships: relationships.map(([, edge]) => edge) }, focus?.id ?? null);
  const rows = new Map<number, FamilyTreeLayoutNode[]>();
  for (const node of overview.nodes) rows.set(node.y, [...(rows.get(node.y) ?? []), node]);
  const orderedRows = [...rows.entries()].sort(([a], [b]) => a - b);
  let previousSpan = -TIER_GROWTH;
  const tiers = orderedRows.map(([y, members]) => {
    const span = Math.max((members.length - 1) * SLOT_GAP, previousSpan + TIER_GROWTH);
    previousSpan = span;
    return { y, span, members: [...members].sort((a, b) => a.x - b.x || compareIds(a.person.id, b.person.id)) };
  });
  const maximumHalfWidth = tiers[tiers.length - 1].span / 2 + NODE_SIZE / 2 + 36;
  const width = 2 * (maximumHalfWidth + MARGIN);
  const height = tiers[tiers.length - 1].y + NODE_SIZE / 2 + MARGIN;
  const centerX = width / 2;
  const positions = new Map<string, Point>();
  for (const tier of tiers) {
    tier.members.forEach((node, index) => {
      const x = tier.members.length > 1 ? centerX - tier.span / 2 + index * tier.span / (tier.members.length - 1) : centerX;
      positions.set(node.person.id, { x, y: tier.y });
    });
  }
  const nodes = overview.nodes.map((node) => ({
    ...node, ...positions.get(node.person.id)!,
    size: compactOthers ? node.size : NODE_SIZE,
    isContext: compactOthers ? node.isContext : false,
  }));
  const byId = new Map(nodes.map((node) => [node.person.id, node]));
  const pyramidLevels = tiers.map((tier) => ({ y: tier.y + NODE_SIZE / 2 + 26, halfWidth: tier.span / 2 + NODE_SIZE / 2 + 36 }));
  // Real populations need not increase in every generation. An empty widening
  // band makes the pyramid legible without duplicating or inventing relatives.
  const right = pyramidLevels.map((level) => `L ${pair({ x: centerX + level.halfWidth, y: level.y })}`);
  const left = [...pyramidLevels].reverse().map((level) => `L ${pair({ x: centerX - level.halfWidth, y: level.y })}`);
  return {
    nodes,
    links: relationships.map(([key, edge]) => ({ key, type: edge.type, relationshipKeys: [key], d: connection(byId.get(edge.fromPersonId)!, byId.get(edge.toPersonId)!, edge, nodes) })),
    width, height, nodeSize: NODE_SIZE, centerPersonId: focus?.id ?? null, rings: [], pyramidLevels,
    pyramidOutline: `M ${pair({ x: centerX, y: 48 })} ${right.join(" ")} ${left.join(" ")} Z`,
  };
}
