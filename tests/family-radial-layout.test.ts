import test from "node:test";
import assert from "node:assert/strict";
import { buildFamilyRadialLayout } from "@/lib/family-radial-layout";
import { getFamilyBySlug } from "@/lib/mock-data";
import type { Family, FamilyRelationship } from "@/lib/types";

function parent(fromPersonId: string, toPersonId: string): FamilyRelationship {
  return { type: "parent", fromPersonId, toPersonId };
}

function spouse(fromPersonId: string, toPersonId: string): FamilyRelationship {
  return { type: "spouse", fromPersonId, toPersonId };
}

function fixture(ids: string[], relationships: FamilyRelationship[] = []): Family {
  const sample = getFamilyBySlug("akhmedov");
  assert.ok(sample);
  return {
    ...structuredClone(sample),
    people: ids.map((id) => ({ ...structuredClone(sample.people[0]), id, firstName: id })),
    archivedPeople: [], relationships,
  };
}

function radius(layout: ReturnType<typeof buildFamilyRadialLayout>, id: string) {
  const node = layout.nodes.find((item) => item.person.id === id)!;
  return Math.hypot(node.x - layout.width / 2, node.y - layout.height / 2);
}

function approximately(actual: number, expected: number, message?: string) {
  assert.ok(Math.abs(actual - expected) < 0.01, message ?? `${actual} ≈ ${expected}`);
}

test("a small family puts the selected person at the center and all relatives on one complete circle", () => {
  const family = fixture(["me", "father", "mother", "wife", "child", "grandfather", "wife-father"], [
    parent("father", "me"), parent("mother", "me"), spouse("me", "wife"), parent("me", "child"),
    parent("grandfather", "father"), parent("wife-father", "wife"),
  ]);
  const layout = buildFamilyRadialLayout(family, "me");
  assert.equal(layout.width, layout.height);
  assert.equal(layout.centerPersonId, "me");
  approximately(radius(layout, "me"), 0);
  assert.deepEqual(layout.nodes.filter((node) => node.isFocus).map((node) => node.person.id), ["me"]);
  const firstRadius = radius(layout, "father");
  assert.ok(firstRadius >= 244);
  for (const id of ["mother", "wife", "child"]) approximately(radius(layout, id), firstRadius);
  approximately(radius(layout, "grandfather"), firstRadius);
  approximately(radius(layout, "wife-father"), firstRadius);
  assert.deepEqual(layout.rings.map((ring) => ring.level), [1]);
  approximately(layout.rings[0].radius, firstRadius);
});

test("an eight-person wedding uses a round seven-person orbit, not sparse generation rings", () => {
  const family = fixture(["rauf", "ayten", "adalat", "esmira", "farida", "zaladdin", "emilia", "avsaddin"], [
    spouse("rauf", "ayten"), spouse("adalat", "esmira"), spouse("zaladdin", "emilia"),
    parent("rauf", "farida"), parent("ayten", "farida"), parent("rauf", "emilia"), parent("ayten", "emilia"),
    parent("adalat", "zaladdin"), parent("esmira", "zaladdin"), parent("adalat", "avsaddin"), parent("esmira", "avsaddin"),
  ]);
  for (const focus of [null, "zaladdin"]) {
    const layout = buildFamilyRadialLayout(family, focus);
    assert.equal(layout.rings.length, 1);
    for (const node of layout.nodes.filter((item) => item.person.id !== layout.centerPersonId)) approximately(radius(layout, node.person.id), layout.rings[0].radius);
    assert.ok(layout.width < 1300, "visible circle should not shrink to fit unused curve-control space");
  }
});

test("default center is graph-based and deterministic, never an implicit selection", () => {
  const family = fixture(["isolated", "child", "hub", "parent", "wife"], [
    parent("hub", "child"), parent("parent", "hub"), spouse("hub", "wife"),
  ]);
  const layout = buildFamilyRadialLayout(family, null);
  assert.equal(layout.centerPersonId, "hub");
  assert.ok(layout.nodes.every((node) => !node.isFocus && !node.isContext && node.size === 188 && node.role === ""));
  assert.deepEqual(buildFamilyRadialLayout({ ...family, people: [...family.people].reverse(), relationships: [...family.relationships].reverse() }, null), layout);
  assert.deepEqual(buildFamilyRadialLayout(family, "missing"), layout);
});

test("only direct family stays full-sized, and compactOthers=false expands everyone without moving nodes", () => {
  const family = fixture(["me", "father", "sibling", "wife", "wife-father", "child", "stranger"], [
    parent("father", "me"), parent("father", "sibling"), spouse("me", "wife"),
    parent("wife-father", "wife"), parent("me", "child"),
  ]);
  const compact = buildFamilyRadialLayout(family, "me");
  const expanded = buildFamilyRadialLayout(family, "me", false);
  for (const node of compact.nodes) {
    const isContext = ["wife-father", "stranger"].includes(node.person.id);
    assert.equal(node.isContext, isContext);
    assert.equal(node.size, isContext ? 124 : 188);
    const full = expanded.nodes.find((item) => item.person.id === node.person.id)!;
    assert.equal(full.x, node.x);
    assert.equal(full.y, node.y);
    assert.equal(full.size, 188);
    assert.equal(full.isContext, false);
  }
  assert.equal(compact.width, expanded.width);
  assert.equal(compact.height, expanded.height);
});

test("every actual parent/spouse edge is preserved once, with no invented co-parent and no invalid edges", () => {
  const family = fixture(["me", "wife", "child", "unrelated", "me"], [
    spouse("me", "wife"), spouse("wife", "me"), parent("me", "child"), parent("me", "child"),
    parent("missing", "child"), parent("me", "me"), spouse("wife", "wife"),
  ]);
  const layout = buildFamilyRadialLayout(family, "me");
  assert.equal(layout.nodes.length, 4);
  assert.deepEqual(layout.links.map((link) => link.key).sort(), ['parent:["me","child"]', 'spouse:["me","wife"]']);
  assert.ok(layout.links.every((link) => link.relationshipKeys?.length === 1 && link.relationshipKeys[0] === link.key));
});

test("curved connections terminate precisely at both visible circular card borders", () => {
  const family = fixture(["me", "wife", "wife-father"], [spouse("me", "wife"), parent("wife-father", "wife")]);
  for (const compact of [false, true]) {
    const layout = buildFamilyRadialLayout(family, "me", compact);
    for (const link of layout.links) {
      assert.match(link.d, /^M [-\d.]+ [-\d.]+ Q [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+$/);
      const coordinates = link.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      assert.ok(coordinates.every(Number.isFinite));
      const [fromId, toId] = JSON.parse(link.key.slice(link.key.indexOf(":") + 1)) as string[];
      const from = layout.nodes.find((node) => node.person.id === fromId)!;
      const to = layout.nodes.find((node) => node.person.id === toId)!;
      approximately(Math.hypot(coordinates[0] - from.x, coordinates[1] - from.y), from.size! / 2);
      approximately(Math.hypot(coordinates[4] - to.x, coordinates[5] - to.y), to.size! / 2);
    }
  }
});

test("a connection between opposite ring members bends around the central person", () => {
  const family = fixture(["me", "a", "b", "c", "d"], [
    spouse("me", "a"), spouse("me", "b"), spouse("me", "c"), spouse("me", "d"), parent("a", "c"),
  ]);
  const layout = buildFamilyRadialLayout(family, "me");
  const link = layout.links.find((item) => item.key === 'parent:["a","c"]')!;
  const [sx, sy, cx, cy, tx, ty] = link.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  for (let index = 0; index <= 100; index += 1) {
    const t = index / 100;
    const x = (1 - t) ** 2 * sx + 2 * (1 - t) * t * cx + t ** 2 * tx;
    const y = (1 - t) ** 2 * sy + 2 * (1 - t) * t * cy + t ** 2 * ty;
    assert.ok(Math.hypot(x - layout.width / 2, y - layout.height / 2) >= 94, "curve must not go through selected person");
    assert.ok(x >= 0 && x <= layout.width && y >= 0 && y <= layout.height, "curve stays inside canvas");
  }
});

test("large rings reserve full-size slots without overlap even when expanded", () => {
  const children = Array.from({ length: 48 }, (_, index) => `child-${index}`);
  const grandchildren = children.map((id) => `${id}-child`);
  const family = fixture(["me", ...children, ...grandchildren], children.flatMap((id, index) => [parent("me", id), parent(id, grandchildren[index])]));
  const layout = buildFamilyRadialLayout(family, "me", false);
  assert.equal(layout.nodes.length, 97);
  assert.equal(layout.rings.length, 4, "visual ring capacities grow instead of forcing everyone into one giant generation ring");
  for (let a = 0; a < layout.nodes.length; a += 1) {
    const first = layout.nodes[a];
    assert.ok(first.x >= 94 && first.x <= layout.width - 94 && first.y >= 94 && first.y <= layout.height - 94);
    for (let b = a + 1; b < layout.nodes.length; b += 1) {
      const second = layout.nodes[b];
      assert.ok(Math.hypot(first.x - second.x, first.y - second.y) >= 244 - 0.01, "all full-size circles have breathing room");
    }
  }
});

test("deep but small ancestry is circular rather than a tall chain of one-person rings", () => {
  const ids = Array.from({ length: 13 }, (_, index) => `person-${index}`);
  const family = fixture(ids, ids.slice(1).map((id, index) => parent(ids[index], id)));
  const layout = buildFamilyRadialLayout(family, ids[0]);
  assert.equal(layout.rings.length, 1);
  for (const id of ids.slice(1)) approximately(radius(layout, id), layout.rings[0].radius);
});

test("cycles, multiple marriages and disconnected components terminate with finite coordinates", () => {
  const family = fixture(["a", "b", "c", "wife-a", "wife-b", "other-a", "other-b", "isolated"], [
    parent("a", "b"), parent("b", "c"), parent("c", "a"), spouse("a", "wife-a"), spouse("a", "wife-b"),
    parent("other-a", "other-b"),
  ]);
  for (const id of [null, ...family.people.map((person) => person.id)]) {
    const layout = buildFamilyRadialLayout(family, id);
    assert.equal(layout.nodes.length, family.people.length);
    assert.equal(layout.links.length, family.relationships.length);
    assert.ok(layout.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
    assert.ok(layout.links.every((link) => !/NaN|Infinity/.test(link.d)));
  }
});

test("empty and single-person families return bounded layouts without decorative rings", () => {
  const empty = buildFamilyRadialLayout(fixture([]), null);
  assert.deepEqual(empty, { nodes: [], links: [], width: 0, height: 0, nodeSize: 188, centerPersonId: null, rings: [] });
  const single = buildFamilyRadialLayout(fixture(["me"]), "me");
  assert.equal(single.nodes.length, 1);
  assert.equal(single.links.length, 0);
  assert.equal(single.rings.length, 0);
  assert.ok(single.width >= 188 && single.height >= 188);
  approximately(radius(single, "me"), 0);
});

test("radial layout does not mutate family data or relationship order", () => {
  const family = fixture(["me", "parent", "wife"], [parent("parent", "me"), spouse("wife", "me")]);
  const before = structuredClone(family);
  const freeze = (value: unknown) => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  };
  freeze(family);
  buildFamilyRadialLayout(family, "me");
  assert.deepEqual(family, before);
});
