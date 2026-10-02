import test from "node:test";
import assert from "node:assert/strict";
import { buildFamilyPyramidLayout } from "@/lib/family-pyramid-layout";
import { buildFamilyGenerationRanks } from "@/lib/family-generation-ranks";
import { repositionFamilyLayout } from "@/lib/family-node-positions";
import { getFamilyBySlug } from "@/lib/mock-data";
import type { Family, FamilyRelationship } from "@/lib/types";

const parent = (fromPersonId: string, toPersonId: string): FamilyRelationship => ({ type: "parent", fromPersonId, toPersonId });
const spouse = (fromPersonId: string, toPersonId: string): FamilyRelationship => ({ type: "spouse", fromPersonId, toPersonId });

function fixture(ids: string[], relationships: FamilyRelationship[] = []): Family {
  const sample = getFamilyBySlug("akhmedov")!;
  return { ...structuredClone(sample), people: ids.map((id) => ({ ...structuredClone(sample.people[0]), id, firstName: id })), archivedPeople: [], relationships };
}

const coordinates = (layout: ReturnType<typeof buildFamilyPyramidLayout>) => layout.nodes.map((node) => ({ id: node.person.id, x: node.x, y: node.y }));

test("pyramid aligns co-parents and their ancestors despite unequal known ancestry", () => {
  const family = fixture(["great", "grandfather", "grandmother", "father", "mother", "child"], [
    parent("great", "grandfather"), parent("grandfather", "father"), parent("grandmother", "mother"),
    parent("father", "child"), parent("mother", "child"),
  ]);
  const layout = buildFamilyPyramidLayout(family, "child");
  const y = (id: string) => layout.nodes.find((node) => node.person.id === id)!.y;
  assert.equal(y("father"), y("mother"));
  assert.equal(y("grandfather"), y("grandmother"));
  assert.ok(y("great") < y("grandfather"));
  assert.ok(y("grandfather") < y("father"));
  assert.ok(y("father") < y("child"));
});

test("pyramid aligns ancestral branches joined by siblings or spouses", () => {
  for (const type of ["spouse", "sibling"] as const) {
    const family = fixture(["great", "left-grand", "left", "right-grand", "right"], [
      parent("great", "left-grand"), parent("left-grand", "left"), parent("right-grand", "right"),
      { type, fromPersonId: "left", toPersonId: "right" },
    ]);
    const layout = buildFamilyPyramidLayout(family, null);
    const y = (id: string) => layout.nodes.find((node) => node.person.id === id)!.y;
    assert.equal(y("left"), y("right"));
    assert.equal(y("left-grand"), y("right-grand"));
    assert.ok(y("great") < y("left-grand"));
  }
});

test("generation ranks keep half siblings and multiple co-parents aligned without inventing edges", () => {
  const family = fixture(["grand", "father", "mother-a", "mother-b", "child-a", "child-b"], [
    parent("grand", "father"), parent("father", "child-a"), parent("mother-a", "child-a"),
    parent("father", "child-b"), parent("mother-b", "child-b"),
  ]);
  const ranks = buildFamilyGenerationRanks(family);
  assert.equal(ranks.get("grand"), 0);
  for (const id of ["father", "mother-a", "mother-b"]) assert.equal(ranks.get(id), 1);
  for (const id of ["child-a", "child-b"]) assert.equal(ranks.get(id), 2);
  assert.equal(buildFamilyPyramidLayout(family, null).links.flatMap(link => link.relationshipKeys!).length, family.relationships.length);
});

test("generation constraints remain finite and deterministic on long chains and contradictory cycles", () => {
  const ids = Array.from({ length: 10000 }, (_, index) => `person-${index.toString().padStart(5, "0")}`);
  const family = fixture(ids, ids.slice(1).map((id, index) => parent(ids[index], id)));
  const ranks = buildFamilyGenerationRanks(family);
  assert.equal(ranks.get(ids[0]), 0);
  assert.equal(ranks.get(ids[9999]), 9999);
  const cyclic = { ...family, relationships: [...family.relationships, parent(ids[9999], ids[0]), parent(ids[0], "unknown")] };
  const cyclicRanks = buildFamilyGenerationRanks(cyclic);
  assert.deepEqual(cyclicRanks, ranks);
  assert.deepEqual(buildFamilyGenerationRanks({ ...cyclic, people: [...cyclic.people].reverse(), relationships: [...cyclic.relationships].reverse() }), ranks);
});

test("pyramid places oldest generations above children and widens every lower generation", () => {
  const family = fixture(["grandparent", "father", "mother", "me", "sibling"], [
    parent("grandparent", "father"), spouse("father", "mother"), parent("father", "me"), parent("father", "sibling"),
  ]);
  const layout = buildFamilyPyramidLayout(family, "me");
  assert.equal(layout.nodes.length, family.people.length);
  const nodes = new Map(layout.nodes.map((node) => [node.person.id, node]));
  assert.ok(nodes.get("grandparent")!.y < nodes.get("father")!.y);
  assert.equal(nodes.get("father")!.y, nodes.get("mother")!.y);
  assert.ok(nodes.get("father")!.y < nodes.get("me")!.y);
  assert.equal(nodes.get("me")!.y, nodes.get("sibling")!.y);
  assert.equal(layout.pyramidLevels.length, 3);
  for (let i = 1; i < layout.pyramidLevels.length; i += 1) assert.ok(layout.pyramidLevels[i].halfWidth > layout.pyramidLevels[i - 1].halfWidth);
  assert.match(layout.pyramidOutline!, /^M .* Z$/);
  assert.deepEqual(layout.rings, []);
});

test("equal-size rows become visibly wider below and narrow younger rows need no invented people", () => {
  const family = fixture(["a", "b", "c", "d", "e", "f", "g", "h", "last"], [
    parent("a", "e"), parent("b", "f"), parent("c", "g"), parent("d", "h"), parent("e", "last"),
  ]);
  const layout = buildFamilyPyramidLayout(family, null);
  const rows = [...new Set(layout.nodes.map((node) => node.y))].sort((a, b) => a - b);
  const span = (y: number) => { const xs = layout.nodes.filter((node) => node.y === y).map((node) => node.x); return Math.max(...xs) - Math.min(...xs); };
  assert.ok(span(rows[1]) > span(rows[0]));
  assert.equal(layout.nodes.filter((node) => node.y === rows[2]).length, 1);
  assert.equal(layout.nodes.find((node) => node.person.id === "last")!.x, layout.width / 2);
  assert.equal(new Set(layout.nodes.map((node) => node.person.id)).size, family.people.length);
  assert.ok(layout.pyramidLevels[2].halfWidth > layout.pyramidLevels[1].halfWidth);
});

test("pyramid selection and compact toggles never move generations or change the canvas", () => {
  const family = fixture(["me", "father", "sibling", "wife", "wife-father", "stranger"], [
    parent("father", "me"), parent("father", "sibling"), spouse("me", "wife"), parent("wife-father", "wife"),
  ]);
  const base = buildFamilyPyramidLayout(family, null);
  for (const id of ["me", "wife", "missing"]) {
    for (const compact of [false, true]) {
      const layout = buildFamilyPyramidLayout(family, id, compact);
      assert.deepEqual(coordinates(layout), coordinates(base));
      assert.equal(layout.width, base.width);
      assert.equal(layout.height, base.height);
      assert.equal(layout.pyramidOutline, base.pyramidOutline);
      if (!compact || id === "missing") assert.ok(layout.nodes.every((node) => node.size === 188 && !node.isContext));
    }
  }
  const focused = buildFamilyPyramidLayout(family, "me");
  assert.equal(focused.nodes.find((node) => node.person.id === "wife-father")!.size, 124);
  assert.equal(focused.nodes.find((node) => node.person.id === "sibling")!.size, 188);
  assert.deepEqual(focused.nodes.filter((node) => node.isFocus).map((node) => node.person.id), ["me"]);
});

test("pyramid preserves each canonical recorded edge once, including half siblings, multiple marriages and cycles", () => {
  const edges = [parent("a", "b"), parent("b", "c"), parent("c", "a"), spouse("a", "wife-a"), spouse("a", "wife-b"), parent("wife-a", "half"), parent("a", "half"), parent("other-a", "other-b")];
  const family = fixture(["a", "b", "c", "wife-a", "wife-b", "half", "other-a", "other-b", "isolated", "a"], [
    ...edges, parent("a", "b"), spouse("wife-a", "a"), parent("a", "missing"), parent("a", "a"),
  ]);
  const layout = buildFamilyPyramidLayout(family, "a");
  assert.equal(layout.nodes.length, 9);
  const keys = edges.map((edge) => `${edge.type}:${JSON.stringify(edge.type === "spouse" ? [edge.fromPersonId, edge.toPersonId].sort() : [edge.fromPersonId, edge.toPersonId])}`).sort();
  assert.deepEqual(layout.links.flatMap((link) => link.relationshipKeys!).sort(), keys);
  assert.ok(layout.links.every((link) => link.relationshipKeys?.length && link.relationshipKeys[0] === link.key));
  for (const node of layout.nodes) {
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
    assert.ok(node.x >= 94 && node.x <= layout.width - 94 && node.y >= 94 && node.y <= layout.height - 94);
  }
  assert.deepEqual(buildFamilyPyramidLayout({ ...family, people: [...family.people].reverse(), relationships: [...family.relationships].reverse() }, "a"), layout);
});

test("pyramid orthogonal buses retain child card ports after manual dragging", () => {
  const family = fixture(["me", "father", "wife", "wife-father"], [parent("father", "me"), spouse("me", "wife"), parent("wife-father", "wife")]);
  const base = buildFamilyPyramidLayout(family, "me");
  const moved = repositionFamilyLayout(base, { me: { x: 60, y: 30 } }, family.relationships);
  for (const layout of [base, moved]) for (const link of layout.links) {
    assert.ok(!/[QC]|NaN|Infinity/.test(link.d));
    assert.ok(link.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number).every(Number.isFinite));
    if (link.type === "parent") for (const key of link.relationshipKeys!) {
      const [, id] = JSON.parse(key.slice(key.indexOf(":") + 1));
      const child = layout.nodes.find(node => node.person.id === id)!;
      assert.ok(link.d.includes(`${child.x} ${child.y - child.height! / 2}`));
    }
  }
  assert.notEqual(moved.links.find(link => link.key === 'parent:["father","me"]')!.d, base.links.find(link => link.key === 'parent:["father","me"]')!.d);
  const me = base.nodes.find(node => node.person.id === "me")!;
  const wife = base.nodes.find(node => node.person.id === "wife")!;
  const coincident = repositionFamilyLayout(base, { wife: { x: me.x - wife.x, y: me.y - wife.y } }, family.relationships);
  assert.ok(coincident.links.every(link => !/NaN|Infinity/.test(link.d)));
});

test("empty, singleton and wide pyramids stay finite, non-overlapping and do not mutate inputs", () => {
  const empty = buildFamilyPyramidLayout(fixture([]), null);
  assert.equal(empty.nodes.length, 0);
  assert.equal(empty.width, 0);
  assert.equal(empty.height, 0);
  assert.deepEqual(empty.pyramidLevels, []);
  const children = Array.from({ length: 32 }, (_, index) => `child-${index}`);
  for (const family of [fixture(["me"]), fixture(["me", ...children], children.map((id) => parent("me", id)))]) {
    const before = structuredClone(family);
    const layout = buildFamilyPyramidLayout(family, "me", false);
    for (let a = 0; a < layout.nodes.length; a += 1) {
      for (let b = a + 1; b < layout.nodes.length; b += 1) assert.ok(Math.hypot(layout.nodes[a].x - layout.nodes[b].x, layout.nodes[a].y - layout.nodes[b].y) >= 244 - 0.01);
    }
    assert.ok(Number.isFinite(layout.width) && Number.isFinite(layout.height));
    assert.deepEqual(family, before);
  }
});
