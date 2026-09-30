import { Family, FamilyPerson, FocusRelatives, RelationshipType } from "@/lib/types";

export function getPersonFullName(person: FamilyPerson) {
  return [person.firstName, person.middleName, person.lastName]
    .filter(Boolean)
    .join(" ");
}

function uniquePeople(people: FamilyPerson[]) {
  return Array.from(new Map(people.map((person) => [person.id, person])).values());
}

export function getFocusRelatives(
  family: Family,
  focusPersonId: string,
): FocusRelatives {
  const personMap = new Map(family.people.map((person) => [person.id, person]));

  const parents = family.relationships
    .filter(
      (relationship) =>
        relationship.type === "parent" && relationship.toPersonId === focusPersonId,
    )
    .map((relationship) => personMap.get(relationship.fromPersonId))
    .filter((person): person is FamilyPerson => Boolean(person));

  const children = family.relationships
    .filter(
      (relationship) =>
        relationship.type === "parent" && relationship.fromPersonId === focusPersonId,
    )
    .map((relationship) => personMap.get(relationship.toPersonId))
    .filter((person): person is FamilyPerson => Boolean(person));

  const spouses = family.relationships
    .filter(
      (relationship) =>
        relationship.type === "spouse" &&
        (relationship.fromPersonId === focusPersonId ||
          relationship.toPersonId === focusPersonId),
    )
    .map((relationship) =>
      relationship.fromPersonId === focusPersonId
        ? personMap.get(relationship.toPersonId)
        : personMap.get(relationship.fromPersonId),
    )
    .filter((person): person is FamilyPerson => Boolean(person));

  const parentIds = new Set(parents.map((parent) => parent.id));

  const siblings = uniquePeople([
    ...family.relationships
      .filter(
        (relationship) =>
          relationship.type === "parent" && parentIds.has(relationship.fromPersonId),
      )
      .map((relationship) => personMap.get(relationship.toPersonId))
      .filter((person): person is FamilyPerson => Boolean(person))
      .filter((person) => person.id !== focusPersonId),
    ...family.relationships
      .filter((relationship) => relationship.type === "sibling" && (relationship.fromPersonId === focusPersonId || relationship.toPersonId === focusPersonId))
      .map((relationship) => personMap.get(relationship.fromPersonId === focusPersonId ? relationship.toPersonId : relationship.fromPersonId))
      .filter((person): person is FamilyPerson => Boolean(person && person.id !== focusPersonId)),
  ]);

  return {
    parents: uniquePeople(parents),
    spouses: uniquePeople(spouses),
    siblings,
    children: uniquePeople(children),
  };
}

export type RelationKind = "focus" | "parent" | "spouse" | "sibling" | "child";

export function getRelationLabel(kind: RelationKind, person: FamilyPerson) {
  if (kind === "focus") {
    return "";
  }
  if (kind === "parent") {
    return person.gender === "male" ? "Отец" : "Мать";
  }
  if (kind === "spouse") {
    return person.gender === "male" ? "Муж" : "Жена";
  }
  if (kind === "child") {
    return person.gender === "male" ? "Сын" : "Дочь";
  }
  return person.gender === "male" ? "Брат" : "Сестра";
}

export type FamilyTreeLayoutNode = {
  person: FamilyPerson;
  x: number;
  y: number;
  role: string;
  isFocus: boolean;
  size?: number;
  isContext?: boolean;
};

export type FamilyTreeLayoutLink = { key: string; d: string; relationshipKeys?: string[]; type?: RelationshipType };

export type FamilyTreeLayout = {
  nodes: FamilyTreeLayoutNode[];
  links: FamilyTreeLayoutLink[];
  width: number;
  height: number;
  nodeSize: number;
};

const NODE_SIZE = 188;
const COL_GAP = 244;
const ROW_GAP = 250;
const MARGIN = 150;

type PlacedNode = {
  person: FamilyPerson;
  x: number;
  y: number;
  role: string;
  isFocus: boolean;
};

export function buildFamilyTreeLayout(
  family: Family,
  focusPersonId: string,
): FamilyTreeLayout {
  const focus =
    family.people.find((person) => person.id === focusPersonId) ?? family.people[0];

  if (!focus) {
    return { nodes: [], links: [], width: 0, height: 0, nodeSize: NODE_SIZE };
  }

  const relatives = getFocusRelatives(family, focus.id);
  const parents = relatives.parents;
  const spouses = relatives.spouses;
  const siblings = relatives.siblings;
  const children = relatives.children;

  const placed: PlacedNode[] = [];
  const placedIds = new Set<string>();
  function place(person: FamilyPerson, x: number, y: number, kind: RelationKind) {
    if (placedIds.has(person.id)) return;
    placedIds.add(person.id);
    placed.push({ person, x, y, role: getRelationLabel(kind, person), isFocus: kind === "focus" });
  }
  place(focus, 0, 0, "focus");

  spouses.forEach((spouse, index) => place(spouse, COL_GAP * (index + 1), 0, "spouse"));

  siblings.forEach((sibling, index) => {
    place(sibling, -COL_GAP * (index + 1), 0, "sibling");
  });

  parents.forEach((parent, index) => {
    place(parent, (index - (parents.length - 1) / 2) * COL_GAP, -ROW_GAP, "parent");
  });

  const childrenMidX = (spouses.length * COL_GAP) / 2;
  const childrenStartX = childrenMidX - ((children.length - 1) * COL_GAP) / 2;
  children.forEach((child, index) => {
    place(child, childrenStartX + index * COL_GAP, ROW_GAP, "child");
  });

  const minX = Math.min(...placed.map((node) => node.x));
  const minY = Math.min(...placed.map((node) => node.y));
  const maxX = Math.max(...placed.map((node) => node.x));
  const maxY = Math.max(...placed.map((node) => node.y));
  const offsetX = MARGIN + NODE_SIZE / 2 - minX;
  const offsetY = MARGIN + NODE_SIZE / 2 - minY;

  const nodes: FamilyTreeLayoutNode[] = placed.map((node) => ({ ...node, x: node.x + offsetX, y: node.y + offsetY }));
  const positionOf = new Map(nodes.map((node) => [node.person.id, node]));
  const radius = NODE_SIZE / 2;
  const links: FamilyTreeLayoutLink[] = [];

  // Marriage is a recorded relationship, not something inferred from sharing a child.
  const coupleAnchors = new Map<string, { x: number; y: number }>();
  const spouseRelationships = family.relationships.filter((relationship) => relationship.type === "spouse");
  for (const relationship of spouseRelationships) {
    const first = positionOf.get(relationship.fromPersonId);
    const second = positionOf.get(relationship.toPersonId);
    if (!first || !second || first === second || first.y !== second.y) continue;
    const pairKey = JSON.stringify([first.person.id, second.person.id].sort());
    if (coupleAnchors.has(pairKey)) continue;
    const [left, right] = first.x < second.x ? [first, second] : [second, first];
    const between = nodes
      .filter((node) => node.y === left.y && node.x > left.x && node.x < right.x)
      .sort((a, b) => a.x - b.x);
    if (!between.length) {
      links.push({ key: `spouse:${pairKey}`, d: `M ${left.x + radius - 10} ${left.y} H ${right.x - radius + 10}` });
      coupleAnchors.set(pairKey, { x: (left.x + right.x) / 2, y: left.y });
    } else {
      // A second spouse must not be joined through the card of the first spouse.
      // Route above the row; descend through the last gap, never through a person.
      const laneY = left.y - radius - 14 - (30 * coupleAnchors.size) / (spouseRelationships.length + 1);
      links.push({
        key: `spouse:${pairKey}`,
        d: `M ${left.x} ${left.y - radius + 8} V ${laneY} H ${right.x} V ${right.y - radius + 8}`,
      });
      coupleAnchors.set(pairKey, { x: (between[between.length - 1].x + right.x) / 2, y: laneY });
    }
  }

  const parentIdsByChild = new Map<string, Set<string>>();
  for (const relationship of family.relationships) {
    if (relationship.type !== "parent") continue;
    const parentIds = parentIdsByChild.get(relationship.toPersonId) ?? new Set<string>();
    parentIds.add(relationship.fromPersonId);
    parentIdsByChild.set(relationship.toPersonId, parentIds);
  }

  function connectChildren(childPeople: FamilyPerson[], prefix: string) {
    const groups = new Map<string, { parents: FamilyTreeLayoutNode[]; children: FamilyTreeLayoutNode[] }>();
    for (const person of childPeople) {
      const child = positionOf.get(person.id);
      if (!child) continue;
      const actualParents = [...(parentIdsByChild.get(person.id) ?? [])]
        .sort()
        .map((id) => positionOf.get(id))
        .filter((parent): parent is FamilyTreeLayoutNode => Boolean(parent && parent.y < child.y));
      if (!actualParents.length) continue;
      const key = JSON.stringify(actualParents.map((parent) => parent.person.id));
      const group = groups.get(key) ?? { parents: actualParents, children: [] };
      group.children.push(child);
      groups.set(key, group);
    }

    // Only children with the exact same recorded, visible parents share a bus.
    // This keeps half siblings and children from different marriages separate.
    [...groups.entries()].forEach(([parentKey, group], groupIndex) => {
      const keyPrefix = groupIndex === 0 ? prefix : `${prefix}-${groupIndex}`;
      const parentY = Math.max(...group.parents.map((parent) => parent.y));
      const childY = Math.min(...group.children.map((child) => child.y));
      const busY = parentY + radius + ((childY - parentY - NODE_SIZE) * (groupIndex + 1)) / (groups.size + 1);
      const couple = group.parents.length === 2 ? coupleAnchors.get(parentKey) : undefined;
      const sourceXs: number[] = [];

      if (couple) {
        // Preserve the continuous drop from the actual spouse line.
        links.push({ key: `${keyPrefix}-drop`, d: `M ${couple.x} ${couple.y} V ${busY}` });
        sourceXs.push(couple.x);
      } else {
        group.parents.forEach((parent, index) => {
          const key = group.parents.length === 1 ? `${keyPrefix}-drop` : `${keyPrefix}-parent-${index}`;
          links.push({ key, d: `M ${parent.x} ${parent.y + radius - 8} V ${busY}` });
          sourceXs.push(parent.x);
        });
      }

      const busXs = [...sourceXs, ...group.children.map((child) => child.x)];
      const minBusX = Math.min(...busXs);
      const maxBusX = Math.max(...busXs);
      if (minBusX !== maxBusX) {
        links.push({ key: `${keyPrefix}-bus`, d: `M ${minBusX} ${busY} H ${maxBusX}` });
      }
      group.children.forEach((child, index) => {
        links.push({ key: `${keyPrefix}-branch-${index}`, d: `M ${child.x} ${busY} V ${child.y - radius + 8}` });
      });
    });
  }

  connectChildren([focus, ...siblings], "ancestors");
  connectChildren(children, "descendants");

  const siblingKeys = new Set<string>();
  for (const relationship of family.relationships) {
    if (relationship.type !== "sibling") continue;
    const [from, to] = [relationship.fromPersonId, relationship.toPersonId].sort();
    const source = positionOf.get(from);
    const target = positionOf.get(to);
    const key = `sibling:${JSON.stringify([from, to])}`;
    if (!source || !target || source === target || siblingKeys.has(key)) continue;
    siblingKeys.add(key);
    const laneY = Math.max(source.y, target.y) + radius + 20;
    links.push({ key, type: "sibling", relationshipKeys: [key], d: `M ${source.x} ${source.y + radius} V ${laneY} H ${target.x} V ${target.y + radius}` });
  }

  return {
    nodes,
    links,
    width: maxX - minX + NODE_SIZE + MARGIN * 2,
    height: maxY - minY + NODE_SIZE + MARGIN * 2,
    nodeSize: NODE_SIZE,
  };
}
