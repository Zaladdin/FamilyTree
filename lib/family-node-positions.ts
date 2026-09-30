import type { FamilyRelationship } from "@/lib/types";
import type { FamilyTreeLayout, FamilyTreeLayoutNode } from "@/lib/family-utils";

export type NodeOffset = { x: number; y: number };
export type NodeOffsets = Readonly<Record<string, NodeOffset>>;

const finitePoint = (point: NodeOffset) => Number.isFinite(point.x) && Number.isFinite(point.y);
const bound = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Pointer deltas are CSS pixels, while node offsets live in unscaled scene units. */
export function screenDragOffset(origin: NodeOffset, delta: NodeOffset, scale: number): NodeOffset {
  if (!finitePoint(delta) || !Number.isFinite(scale) || scale <= 0) return origin;
  return { x: origin.x + delta.x / scale, y: origin.y + delta.y / scale };
}

export function constrainNodeOffset(node: FamilyTreeLayoutNode, layout: FamilyTreeLayout, offset: NodeOffset): NodeOffset {
  if (!finitePoint(offset)) return { x: 0, y: 0 };
  const margin = (node.size ?? layout.nodeSize) / 2 + 24;
  return {
    x: bound(node.x + offset.x, margin, Math.max(margin, layout.width - margin)) - node.x,
    y: bound(node.y + offset.y, margin, Math.max(margin, layout.height - margin)) - node.y,
  };
}

function edgeKey(edge: FamilyRelationship) {
  const pair = [edge.fromPersonId, edge.toPersonId];
  return `${edge.type}:${JSON.stringify(edge.type === "parent" ? pair : pair.sort())}`;
}

function connectCircles(source: FamilyTreeLayoutNode, target: FamilyTreeLayoutNode, size: number) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  const bend = Math.min(36, length * 0.08);
  const control = {
    x: (source.x + target.x) / 2 - (length ? dy / length * bend : 0),
    y: (source.y + target.y) / 2 + (length ? dx / length * bend : 0),
  };
  function border(node: FamilyTreeLayoutNode) {
    const distance = Math.hypot(control.x - node.x, control.y - node.y);
    // Coincident nodes have no visible connecting segment; retain the real key.
    if (!distance) return { x: node.x, y: node.y };
    const radius = (node.size ?? size) / 2;
    return { x: node.x + (control.x - node.x) / distance * radius, y: node.y + (control.y - node.y) / distance * radius };
  }
  const pair = (point: NodeOffset) => `${Number(point.x.toFixed(4))} ${Number(point.y.toFixed(4))}`;
  return `M ${pair(border(source))} Q ${pair(control)} ${pair(border(target))}`;
}

/** Manual placement is a view-only overlay: no relationship or family mutations. */
export function repositionFamilyLayout<T extends FamilyTreeLayout>(layout: T, offsets: NodeOffsets, relationships: FamilyRelationship[]): T {
  const movedIds = new Set<string>();
  const nodes = layout.nodes.map((node) => {
    const candidate = Object.hasOwn(offsets, node.person.id) ? offsets[node.person.id] : undefined;
    if (!candidate || !finitePoint(candidate)) return node;
    const offset = constrainNodeOffset(node, layout, candidate);
    if (!offset.x && !offset.y) return node;
    movedIds.add(node.person.id);
    return { ...node, x: node.x + offset.x, y: node.y + offset.y };
  });
  if (!movedIds.size) return layout;
  const byId = new Map(nodes.map((node) => [node.person.id, node]));
  const edges = new Map(relationships.map((edge) => [edgeKey(edge), edge]));
  return {
    ...layout, nodes,
    links: layout.links.map((link) => {
      const edge = edges.get(link.key);
      if (!edge || (!movedIds.has(edge.fromPersonId) && !movedIds.has(edge.toPersonId))) return link;
      const pair = edge.type === "parent" ? [edge.fromPersonId, edge.toPersonId] : [edge.fromPersonId, edge.toPersonId].sort();
      const source = byId.get(pair[0]);
      const target = byId.get(pair[1]);
      return source && target ? { ...link, d: connectCircles(source, target, layout.nodeSize) } : link;
    }),
  };
}
