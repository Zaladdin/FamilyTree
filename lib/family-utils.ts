import { Family, FamilyPerson, FocusRelatives } from "@/lib/types";

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

  const siblings = uniquePeople(
    family.relationships
      .filter(
        (relationship) =>
          relationship.type === "parent" && parentIds.has(relationship.fromPersonId),
      )
      .map((relationship) => personMap.get(relationship.toPersonId))
      .filter((person): person is FamilyPerson => Boolean(person))
      .filter((person) => person.id !== focusPersonId),
  );

  return { parents, spouses, siblings, children };
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
};

export type FamilyTreeLayoutLink = { key: string; d: string };

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
  const parents = relatives.parents.slice(0, 2);
  const spouse = relatives.spouses[0];
  const siblings = relatives.siblings;
  const children = relatives.children;

  const placed: PlacedNode[] = [];
  placed.push({ person: focus, x: 0, y: 0, role: getRelationLabel("focus", focus), isFocus: true });

  const spouseX = COL_GAP;
  if (spouse) {
    placed.push({ person: spouse, x: spouseX, y: 0, role: getRelationLabel("spouse", spouse), isFocus: false });
  }

  siblings.forEach((sibling, index) => {
    placed.push({ person: sibling, x: -COL_GAP * (index + 1), y: 0, role: getRelationLabel("sibling", sibling), isFocus: false });
  });

  const parentsY = -ROW_GAP;
  if (parents.length === 2) {
    placed.push({ person: parents[0], x: -COL_GAP / 2, y: parentsY, role: getRelationLabel("parent", parents[0]), isFocus: false });
    placed.push({ person: parents[1], x: COL_GAP / 2, y: parentsY, role: getRelationLabel("parent", parents[1]), isFocus: false });
  } else if (parents.length === 1) {
    placed.push({ person: parents[0], x: 0, y: parentsY, role: getRelationLabel("parent", parents[0]), isFocus: false });
  }

  const childrenMidX = spouse ? spouseX / 2 : 0;
  const childrenStartX = childrenMidX - ((children.length - 1) * COL_GAP) / 2;
  children.forEach((child, index) => {
    placed.push({ person: child, x: childrenStartX + index * COL_GAP, y: ROW_GAP, role: getRelationLabel("child", child), isFocus: false });
  });

  const minX = Math.min(...placed.map((node) => node.x));
  const minY = Math.min(...placed.map((node) => node.y));
  const maxX = Math.max(...placed.map((node) => node.x));
  const maxY = Math.max(...placed.map((node) => node.y));
  const offsetX = MARGIN + NODE_SIZE / 2 - minX;
  const offsetY = MARGIN + NODE_SIZE / 2 - minY;

  const nodes: FamilyTreeLayoutNode[] = placed.map((node) => ({ ...node, x: node.x + offsetX, y: node.y + offsetY }));
  const positionOf = new Map(nodes.map((node) => [node.person.id, { x: node.x, y: node.y }]));
  const radius = NODE_SIZE / 2;
  const links: FamilyTreeLayoutLink[] = [];

  const connectDown = (parentPeople: FamilyPerson[], childPeople: FamilyPerson[], keyPrefix: string) => {
    const parentPositions = parentPeople.map((p) => positionOf.get(p.id)).filter((v): v is { x: number; y: number } => Boolean(v));
    const childPositions = childPeople.map((p) => positionOf.get(p.id)).filter((v): v is { x: number; y: number } => Boolean(v));
    if (!parentPositions.length || !childPositions.length) return;
    const parentY = Math.max(...parentPositions.map((p) => p.y));
    const anchorX = parentPositions.reduce((t, p) => t + p.x, 0) / parentPositions.length;
    const childY = Math.min(...childPositions.map((p) => p.y));
    const busY = (parentY + childY) / 2;
    if (parentPositions.length >= 2) {
      const sorted = [...parentPositions].sort((a, b) => a.x - b.x);
      const left = sorted[0];
      const right = sorted[sorted.length - 1];
      links.push({ key: keyPrefix + "-couple", d: "M " + (left.x + radius - 10) + " " + left.y + " H " + (right.x - radius + 10) });
    }
    links.push({ key: keyPrefix + "-drop", d: "M " + anchorX + " " + (parentY + radius - 8) + " V " + busY });
    const minChildX = Math.min(...childPositions.map((p) => p.x));
    const maxChildX = Math.max(...childPositions.map((p) => p.x));
    if (childPositions.length > 1) links.push({ key: keyPrefix + "-bus", d: "M " + minChildX + " " + busY + " H " + maxChildX });
    childPositions.forEach((p, i) => {
      links.push({ key: keyPrefix + "-branch-" + i, d: "M " + p.x + " " + busY + " V " + (p.y - radius + 8) });
    });
  };

  connectDown(parents, [focus, ...siblings], "ancestors");

  if (spouse) {
    const fp = positionOf.get(focus.id);
    const sp = positionOf.get(spouse.id);
    if (fp && sp) {
      const left = fp.x <= sp.x ? fp : sp;
      const right = fp.x <= sp.x ? sp : fp;
      links.push({ key: "spouse-link", d: "M " + (left.x + radius - 10) + " " + left.y + " H " + (right.x - radius + 10) });
    }
  }

  connectDown(spouse ? [focus, spouse] : [focus], children, "descendants");

  return {
    nodes,
    links,
    width: maxX - minX + NODE_SIZE + MARGIN * 2,
    height: maxY - minY + NODE_SIZE + MARGIN * 2,
    nodeSize: NODE_SIZE,
  };
}
