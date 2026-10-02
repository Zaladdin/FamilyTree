import type { FamilyRelationship } from "@/lib/types";
import type { FamilyTreeLayoutLink, FamilyTreeLayoutNode } from "@/lib/family-utils";

export const FAMILY_CARD_WIDTH = 220;
export const FAMILY_CARD_HEIGHT = 96;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const keyOf = (edge: FamilyRelationship) => `${edge.type}:${JSON.stringify(edge.type === "parent" ? [edge.fromPersonId, edge.toPersonId] : [edge.fromPersonId, edge.toPersonId].sort(compare))}`;
type Point = { u: number; v: number };

/** Each bus represents one exact recorded parent set, so half siblings and
 * multiple partnerships never acquire the other household's parent edges. */
export function buildOrthogonalFamilyLinks(nodes: FamilyTreeLayoutNode[], relationships: FamilyRelationship[], horizontal = false): FamilyTreeLayoutLink[] {
  const byId = new Map(nodes.map(node => [node.person.id, node]));
  const edges = [...new Map(relationships.filter(edge => byId.has(edge.fromPersonId) && byId.has(edge.toPersonId)
    && edge.fromPersonId !== edge.toPersonId && ["parent", "spouse", "sibling"].includes(edge.type))
    .map(edge => [keyOf(edge), edge])).entries()].sort(([a], [b]) => compare(a, b));
  const point = (node: FamilyTreeLayoutNode): Point => ({ u: horizontal ? node.y : node.x, v: horizontal ? node.x : node.y });
  const halfAcross = (node: FamilyTreeLayoutNode) => (horizontal ? node.height ?? FAMILY_CARD_HEIGHT : node.width ?? FAMILY_CARD_WIDTH) / 2;
  const halfAlong = (node: FamilyTreeLayoutNode) => (horizontal ? node.width ?? FAMILY_CARD_WIDTH : node.height ?? FAMILY_CARD_HEIGHT) / 2;
  const path = (points: Point[]) => points.map((p, index) => `${index ? "L" : "M"} ${Number((horizontal ? p.v : p.u).toFixed(4))} ${Number((horizontal ? p.u : p.v).toFixed(4))}`).join(" ");
  const links: FamilyTreeLayoutLink[] = [];
  const partnerJunctions = new Map<string, Point>();
  for (const [key, edge] of edges.filter(([, edge]) => edge.type !== "parent")) {
    const ordered = [byId.get(edge.fromPersonId)!, byId.get(edge.toPersonId)!].sort((a, b) => point(a).u - point(b).u || compare(a.person.id, b.person.id));
    const [a, b] = ordered;
    const ap = point(a), bp = point(b);
    const start = { u: ap.u + halfAcross(a), v: ap.v };
    const end = { u: bp.u - halfAcross(b), v: bp.v };
    const middleU = (start.u + end.u) / 2;
    const obstructed = nodes.some(node => node !== a && node !== b && point(node).u > ap.u && point(node).u < bp.u
      && Math.abs(point(node).v - ap.v) < halfAlong(node) + 12);
    const straight = ap.v === bp.v && !obstructed && edge.type === "spouse";
    const lane = Math.min(ap.v - halfAlong(a), bp.v - halfAlong(b)) - (edge.type === "sibling" ? 40 : 24);
    const points = straight ? [start, end] : [start, { u: start.u + 12, v: start.v }, { u: start.u + 12, v: lane }, { u: end.u - 12, v: lane }, { u: end.u - 12, v: end.v }, end];
    links.push({ key, type: edge.type, relationshipKeys: [key], d: path(points) });
    // A non-adjacent partner's trunk descends in the clear gap beside the first
    // card instead of through an intervening partner's card at the midpoint.
    if (edge.type === "spouse") partnerJunctions.set(JSON.stringify([a.person.id, b.person.id].sort(compare)), { u: obstructed ? start.u + 12 : middleU, v: straight ? ap.v : lane });
  }
  const parentsByChild = new Map<string, string[]>();
  for (const [, edge] of edges) if (edge.type === "parent") parentsByChild.set(edge.toPersonId, [...(parentsByChild.get(edge.toPersonId) ?? []), edge.fromPersonId]);
  const groups = new Map<string, { parents: string[]; children: string[] }>();
  for (const [child, parents] of parentsByChild) {
    parents.sort(compare);
    const key = JSON.stringify(parents);
    const group = groups.get(key) ?? { parents, children: [] };
    group.children.push(child);
    groups.set(key, group);
  }
  const occupiedBuses: Array<{ left: number; right: number; v: number }> = [];
  for (const [, group] of [...groups.entries()].sort(([a], [b]) => compare(a, b))) {
    const parents = group.parents.map(id => byId.get(id)!);
    const children = group.children.sort(compare).map(id => byId.get(id)!);
    const parentPorts = parents.map(node => ({ u: point(node).u, v: point(node).v + halfAlong(node) }));
    const childPorts = children.map(node => ({ u: point(node).u, v: point(node).v - halfAlong(node) }));
    const partnership = parents.length === 2 ? partnerJunctions.get(JSON.stringify(group.parents)) : undefined;
    const origin = partnership ?? { u: parentPorts.reduce((sum, p) => sum + p.u, 0) / parentPorts.length, v: Math.max(...parentPorts.map(p => p.v)) + (parents.length > 1 ? 24 : 0) };
    const childTop = Math.min(...childPorts.map(p => p.v));
    const preferredBusV = (Math.max(origin.v, ...parentPorts.map(p => p.v)) + childTop) / 2;
    const busUs = [origin.u, ...childPorts.map(p => p.u)];
    const left = Math.min(...busUs), right = Math.max(...busUs);
    let busV = preferredBusV;
    // Different recorded households must not share a horizontal segment: that
    // would visually turn half siblings into children of every co-parent.
    // Stable group ordering and bounded candidates make routing reproducible.
    const step = childTop > preferredBusV ? Math.max(1, (childTop - preferredBusV) / (groups.size + 1)) : 12;
    for (let attempt = 1; attempt <= groups.size && occupiedBuses.some(bus => left <= bus.right && right >= bus.left && Math.abs(bus.v - busV) < 0.0001); attempt++) {
      busV = preferredBusV + step * attempt;
    }
    occupiedBuses.push({ left, right, v: busV });
    const segments: string[] = [];
    if (!partnership && parents.length > 1) for (const port of parentPorts) segments.push(path([port, { u: port.u, v: origin.v }, origin]));
    segments.push(path([origin, { u: origin.u, v: busV }]));
    segments.push(path([{ u: left, v: busV }, { u: right, v: busV }]));
    for (const port of childPorts) segments.push(path([{ u: port.u, v: busV }, port]));
    const relationshipKeys = group.parents.flatMap(fromPersonId => group.children.map(toPersonId => keyOf({ type: "parent", fromPersonId, toPersonId }))).sort(compare);
    links.push({ key: relationshipKeys[0], type: "parent", relationshipKeys, d: segments.join(" ") });
  }
  return links.sort((a, b) => compare(a.key, b.key));
}
