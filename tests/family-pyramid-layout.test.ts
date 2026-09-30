import test from "node:test";
import assert from "node:assert/strict";
import { buildFamilyPyramidLayout } from "@/lib/family-pyramid-layout";
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
  assert.deepEqual(layout.links.map((link) => link.key).sort(), keys);
  assert.ok(layout.links.every((link) => link.relationshipKeys?.length === 1 && link.relationshipKeys[0] === link.key));
  for (const node of layout.nodes) {
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
    assert.ok(node.x >= 94 && node.x <= layout.width - 94 && node.y >= 94 && node.y <= layout.height - 94);
  }
  assert.deepEqual(buildFamilyPyramidLayout({ ...family, people: [...family.people].reverse(), relationships: [...family.relationships].reverse() }, "a"), layout);
});

test("pyramid curves clip to visible circles and manual dragging updates exact incident edges", () => {
  const family = fixture(["me", "father", "wife", "wife-father"], [parent("father", "me"), spouse("me", "wife"), parent("wife-father", "wife")]);
  const base = buildFamilyPyramidLayout(family, "me");
  const moved = repositionFamilyLayout(base, { me: { x: 60, y: 30 } }, family.relationships);
  for (const layout of [base, moved]) {
    for (const link of layout.links) {
      const numbers = link.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      assert.equal(numbers.length, 6);
      assert.ok(numbers.every(Number.isFinite));
      const [from, to] = JSON.parse(link.key.slice(link.key.indexOf(":") + 1));
      const source = layout.nodes.find((node) => node.person.id === from)!;
      const target = layout.nodes.find((node) => node.person.id === to)!;
      assert.ok(Math.abs(Math.hypot(numbers[0] - source.x, numbers[1] - source.y) - source.size! / 2) < 0.01);
      assert.ok(Math.abs(Math.hypot(numbers[4] - target.x, numbers[5] - target.y) - target.size! / 2) < 0.01);
      if (layout === moved) assert.equal(link.d === base.links.find((item) => item.key === link.key)!.d, ![from, to].includes("me"));
    }
  }
  const me = base.nodes.find((node) => node.person.id === "me")!;
  const wife = base.nodes.find((node) => node.person.id === "wife")!;
  const coincident = repositionFamilyLayout(base, { wife: { x: me.x - wife.x, y: me.y - wife.y } }, family.relationships);
  assert.ok(coincident.links.every((link) => !/NaN|Infinity/.test(link.d)));
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
