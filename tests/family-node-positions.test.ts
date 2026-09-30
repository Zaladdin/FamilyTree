import test from "node:test";
import assert from "node:assert/strict";
import { getFamilyBySlug } from "@/lib/mock-data";
import { buildFamilyDisplayLayout } from "@/lib/family-display-layout";
import { constrainNodeOffset, repositionFamilyLayout, screenDragOffset } from "@/lib/family-node-positions";

const family = getFamilyBySlug("akhmedov")!;

test("screen dragging follows the pointer at every zoom and rejects invalid coordinates", () => {
  assert.deepEqual(screenDragOffset({ x: 10, y: -20 }, { x: 60, y: 30 }, 0.5), { x: 130, y: 40 });
  assert.deepEqual(screenDragOffset({ x: 0, y: 0 }, { x: 28, y: -14 }, 1.4), { x: 20, y: -10 });
  assert.deepEqual(screenDragOffset({ x: 2, y: 3 }, { x: Infinity, y: 4 }, 1), { x: 2, y: 3 });
  assert.deepEqual(screenDragOffset({ x: 2, y: 3 }, { x: 4, y: 4 }, 0), { x: 2, y: 3 });
});

test("moving a circle preserves all people, recorded edge keys, canvas dimensions and unmoved positions", () => {
  const base = buildFamilyDisplayLayout(family, "timur");
  const before = structuredClone(base);
  const moved = repositionFamilyLayout(base, { timur: { x: 100, y: 80 } }, family.relationships);
  assert.deepEqual(base, before, "never mutates the automatic layout or family");
  assert.equal(moved.width, base.width);
  assert.equal(moved.height, base.height);
  assert.deepEqual(moved.links.map((link) => link.key), base.links.map((link) => link.key));
  for (const node of moved.nodes) {
    const original = base.nodes.find((item) => item.person.id === node.person.id)!;
    assert.equal(node.x, original.x + (node.person.id === "timur" ? 100 : 0));
    assert.equal(node.y, original.y + (node.person.id === "timur" ? 80 : 0));
  }
  for (const link of moved.links) {
    const original = base.links.find((item) => item.key === link.key)!;
    if (link.key.includes('"timur"')) assert.notEqual(link.d, original.d);
    else assert.equal(link.d, original.d);
    assert.doesNotMatch(link.d, /NaN|Infinity/);
  }
  assert.deepEqual(repositionFamilyLayout(base, {}, family.relationships), base, "reset is exactly the original circle");
});

test("drag bounds keep full circles inside the canvas and ignore unknown/invalid offsets", () => {
  const base = buildFamilyDisplayLayout(family, "timur");
  const node = base.nodes.find((item) => item.person.id === "timur")!;
  const offset = constrainNodeOffset(node, base, { x: -100000, y: 100000 });
  const moved = repositionFamilyLayout(base, { timur: offset, missing: { x: 1, y: 1 }, ahmed: { x: NaN, y: 0 } }, family.relationships);
  const target = moved.nodes.find((item) => item.person.id === "timur")!;
  assert.ok(target.x - target.size! / 2 >= 24);
  assert.ok(target.y + target.size! / 2 <= base.height - 24);
  assert.deepEqual(moved.nodes.find((item) => item.person.id === "ahmed"), base.nodes.find((item) => item.person.id === "ahmed"));
  assert.equal(moved.nodes.length, base.nodes.length);
});

test("links remain finite when two connected circles occupy the same point", () => {
  const base = buildFamilyDisplayLayout(family, "timur");
  const first = base.nodes.find((item) => item.person.id === "timur")!;
  const second = base.nodes.find((item) => item.person.id === "leyla")!;
  const moved = repositionFamilyLayout(base, { leyla: { x: first.x - second.x, y: first.y - second.y } }, family.relationships);
  assert.equal(moved.links.length, base.links.length);
  for (const link of moved.links) assert.doesNotMatch(link.d, /NaN|Infinity/);
});

test("rerouted parent and spouse curves end on the resized circle borders", () => {
  const base = buildFamilyDisplayLayout(family, "timur");
  const moved = repositionFamilyLayout(base, { timur: { x: 70, y: 10 } }, family.relationships);
  for (const link of moved.links.filter((item) => item.key.includes('"timur"'))) {
    const [from, to] = JSON.parse(link.key.slice(link.key.indexOf(":") + 1)) as string[];
    const source = moved.nodes.find((item) => item.person.id === from)!;
    const target = moved.nodes.find((item) => item.person.id === to)!;
    const numbers = link.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    assert.ok(Math.abs(Math.hypot(numbers[0] - source.x, numbers[1] - source.y) - source.size! / 2) < 0.01);
    assert.ok(Math.abs(Math.hypot(numbers[4] - target.x, numbers[5] - target.y) - target.size! / 2) < 0.01);
  }
});
