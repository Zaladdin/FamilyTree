import test from "node:test";
import assert from "node:assert/strict";
import { buildFamilyDisplayLayout } from "@/lib/family-display-layout";
import { getFamilyBySlug } from "@/lib/mock-data";
import { constrainNodeOffset, repositionFamilyLayout } from "@/lib/family-node-positions";
import { buildOrthogonalFamilyLinks } from "@/lib/family-orthogonal-links";
import { fitTreeViewport, focusTreeViewport } from "@/lib/tree-viewport";
import type { Family, FamilyRelationship } from "@/lib/types";

const parent = (fromPersonId: string, toPersonId: string): FamilyRelationship => ({ type: "parent", fromPersonId, toPersonId });
function fixture(): Family {
  const sample = getFamilyBySlug("akhmedov")!;
  return { ...sample, people: ["a", "b", "c", "d", "e", "f"].map(id => ({ ...sample.people[0], id })), relationships: [
    { type: "spouse", fromPersonId: "a", toPersonId: "b" },
    parent("a", "c"), parent("b", "c"), parent("a", "d"), parent("b", "d"), parent("a", "e"), parent("f", "e"),
  ] };
}
for (const mode of ["pyramid", "generations", "horizontal"] as const) {
  test(`${mode} rectangular cards connect recorded co-parents through a shared sibling bus`, () => {
    const family = fixture();
    const layout = buildFamilyDisplayLayout(family, null, false, undefined, mode);
    assert.ok(layout.nodes.every(node => "width" in node && node.width === 220 && "height" in node && node.height === 96));
    assert.ok(layout.links.every(link => !/[QC]/.test(link.d)));
    const group = layout.links.find(link => link.relationshipKeys?.includes('parent:["a","c"]'))!;
    assert.deepEqual(group.relationshipKeys?.slice().sort(), ['parent:["a","c"]', 'parent:["a","d"]', 'parent:["b","c"]', 'parent:["b","d"]']);
    const keys = layout.links.flatMap(link => link.relationshipKeys ?? []);
    assert.equal(keys.length, family.relationships.length);
    assert.equal(new Set(keys).size, keys.length);
    const moved = repositionFamilyLayout(layout, { c: { x: 20, y: 10 } }, family.relationships);
    assert.notEqual(moved.links.find(link => link.key === group.key)?.d, group.d);
    assert.ok(moved.links.every(link => !/[QC]|NaN|Infinity/.test(link.d)));
    const node = layout.nodes[0];
    const offset = constrainNodeOffset(node, layout, { x: -1e6, y: -1e6 });
    assert.equal(node.x + offset.x, 134);
    assert.equal(node.y + offset.y, 72);
  });
}
test("radial cards retain circular geometry", () => {
  const layout = buildFamilyDisplayLayout(fixture(), null);
  assert.ok(layout.nodes.every(node => !("width" in node) && !("height" in node)));
  assert.ok(layout.links.some(link => /Q/.test(link.d)));
});

test("adjacent spouses share a midpoint trunk and exact sibling bus without a gap", () => {
  const family = fixture();
  const nodes = [
    { id: "a", x: 200, y: 180 }, { id: "b", x: 500, y: 180 },
    { id: "c", x: 180, y: 420 }, { id: "d", x: 460, y: 420 },
  ].map(({ id, x, y }) => ({ person: { ...family.people[0], id }, x, y, width: 220, height: 96, role: "", isFocus: false }));
  const links = buildOrthogonalFamilyLinks(nodes, family.relationships);
  assert.equal(links.find(link => link.type === "spouse")!.d, "M 310 180 L 390 180");
  const bus = links.find(link => link.type === "parent")!;
  assert.ok(bus.d.startsWith("M 350 180 L 350 300"));
  assert.ok(bus.d.includes("M 180 300 L 460 300"));
  assert.ok(bus.d.includes("M 180 300 L 180 372"));
  assert.ok(bus.d.includes("M 460 300 L 460 372"));
});

test("multiple partnerships route a distant partner trunk outside intervening cards", () => {
  const sample = fixture().people[0];
  const nodes = [
    { id: "a", x: 200, y: 180 }, { id: "b", x: 500, y: 180 }, { id: "f", x: 800, y: 180 },
    { id: "c", x: 300, y: 420 }, { id: "e", x: 680, y: 420 },
  ].map(({ id, x, y }) => ({ person: { ...sample, id }, x, y, width: 220, height: 96, role: "", isFocus: false }));
  const edges: FamilyRelationship[] = [
    { type: "spouse", fromPersonId: "a", toPersonId: "b" },
    { type: "spouse", fromPersonId: "a", toPersonId: "f" },
    parent("a", "c"), parent("b", "c"), parent("a", "e"), parent("f", "e"),
  ];
  const links = buildOrthogonalFamilyLinks(nodes, edges);
  const distant = links.find(link => link.relationshipKeys?.includes('parent:["f","e"]'))!;
  assert.ok(distant.d.startsWith("M 322 108 L 322 324"), "trunk descends through free space beside first spouse on a separate bus lane");
  assert.deepEqual(distant.relationshipKeys, ['parent:["a","e"]', 'parent:["f","e"]']);
  assert.deepEqual(buildOrthogonalFamilyLinks([...nodes].reverse(), [...edges].reverse()), links);
});

test("a lone parent starts from the card bottom and direct siblings never invent parents", () => {
  const sample = fixture().people[0];
  const nodes = [{ id: "a", x: 200, y: 180 }, { id: "c", x: 200, y: 420 }, { id: "d", x: 500, y: 420 }]
    .map(({ id, x, y }) => ({ person: { ...sample, id }, x, y, width: 220, height: 96, role: "", isFocus: false }));
  const links = buildOrthogonalFamilyLinks(nodes, [parent("a", "c"), { type: "sibling", fromPersonId: "c", toPersonId: "d" }]);
  assert.ok(links.find(link => link.type === "parent")!.d.startsWith("M 200 228"));
  assert.deepEqual(links.flatMap(link => link.relationshipKeys!), ['parent:["a","c"]', 'sibling:["c","d"]']);
});

test("overlapping half-sibling households use distinct deterministic bus lanes", () => {
  const sample = fixture().people[0];
  const nodes = [{ id: "a", x: 200, y: 200 }, { id: "b", x: 500, y: 200 }, { id: "c", x: 800, y: 200 },
    { id: "x", x: 200, y: 440 }, { id: "y", x: 800, y: 440 }]
    .map(({ id, x, y }) => ({ person: { ...sample, id }, x, y, width: 220, height: 96, role: "", isFocus: false }));
  const edges: FamilyRelationship[] = [{ type: "spouse", fromPersonId: "a", toPersonId: "b" }, { type: "spouse", fromPersonId: "a", toPersonId: "c" },
    parent("a", "x"), parent("b", "x"), parent("a", "y"), parent("c", "y")];
  const links = buildOrthogonalFamilyLinks(nodes, edges);
  const groups = links.filter(link => link.type === "parent");
  const lane = (d: string) => Number(d.match(/^M [-\d.]+ [-\d.]+ L [-\d.]+ ([-\d.]+)/)![1]);
  assert.notEqual(lane(groups[0].d), lane(groups[1].d));
  assert.deepEqual(buildOrthogonalFamilyLinks([...nodes].reverse(), [...edges].reverse()), links);
});

test("rectangular viewport fit and focus retain both width and height after dragging", () => {
  for (const mode of ["pyramid", "generations", "horizontal"] as const) {
    const family = fixture();
    const layout = repositionFamilyLayout(buildFamilyDisplayLayout(family, null, false, undefined, mode), { a: { x: -10000, y: -10000 } }, family.relationships);
    const viewport = { width: 290, height: 420 };
    const fit = fitTreeViewport(viewport, layout);
    for (const node of layout.nodes) {
      assert.ok(fit.x + (node.x - node.width! / 2) * fit.scale >= 0);
      assert.ok(fit.x + (node.x + node.width! / 2) * fit.scale <= viewport.width);
      assert.ok(fit.y + (node.y - node.height! / 2) * fit.scale >= 0);
      assert.ok(fit.y + (node.y + node.height! / 2) * fit.scale <= viewport.height);
    }
    const focus = focusTreeViewport({ width: 240, height: 260 }, layout, "a");
    assert.ok(focus.scale * 220 <= 192);
    assert.ok(focus.scale * 96 <= 108);
  }
});
