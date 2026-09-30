import test from "node:test";
import assert from "node:assert/strict";
import { buildFamilyOverviewLayout } from "@/lib/family-overview-layout";
import { getFamilyBySlug } from "@/lib/mock-data";
import type { Family, FamilyRelationship } from "@/lib/types";

function sampleFamily(): Family {
  const family = getFamilyBySlug("akhmedov");
  assert.ok(family);
  return structuredClone(family);
}

function fixture(ids: string[], relationships: FamilyRelationship[]): Family {
  const sample = sampleFamily();
  return {
    ...sample,
    people: ids.map((id) => ({ ...sample.people[0], id, firstName: id, mediaAssets: [], stories: [] })),
    relationships,
  };
}

function parent(fromPersonId: string, toPersonId: string): FamilyRelationship {
  return { type: "parent", fromPersonId, toPersonId };
}

function spouse(fromPersonId: string, toPersonId: string): FamilyRelationship {
  return { type: "spouse", fromPersonId, toPersonId };
}

function parentLink(layout: ReturnType<typeof buildFamilyOverviewLayout>, from: string, to: string) {
  const key = `parent:${JSON.stringify([from, to])}`;
  const link = layout.links.find((item) => item.key === key)
    ?? layout.links.find((item) => item.key.endsWith(`:child:${to}`) && item.relationshipKeys?.includes(key));
  assert.ok(link);
  return link;
}

function coordinates(layout: ReturnType<typeof buildFamilyOverviewLayout>) {
  return layout.nodes.map((node) => ({ id: node.person.id, x: node.x, y: node.y }));
}

test("overview retains everyone including disconnected people for every selected person", () => {
  const family = sampleFamily();
  family.people.push({ ...family.people[0], id: "unrelated", firstName: "Отдельная ветвь" });
  const expectedIds = family.people.map((person) => person.id).sort();
  const overview = buildFamilyOverviewLayout(family, null);
  for (const person of family.people) {
    const focused = buildFamilyOverviewLayout(family, person.id);
    assert.deepEqual(focused.nodes.map((node) => node.person.id).sort(), expectedIds);
    assert.deepEqual(coordinates(focused), coordinates(overview));
    assert.equal(focused.width, overview.width);
    assert.equal(focused.height, overview.height);
    assert.deepEqual(focused.nodes.filter((node) => node.isFocus).map((node) => node.person.id), [person.id]);
  }
});

test("only the focus, parents, spouses, children and siblings stay full size", () => {
  const layout = buildFamilyOverviewLayout(sampleFamily(), "timur");
  const fullSize = ["timur", "ahmed", "amina", "leyla", "ilyas", "safiya"];
  for (const node of layout.nodes) {
    assert.equal(node.size, fullSize.includes(node.person.id) ? 188 : 124);
    assert.equal(node.isContext, !fullSize.includes(node.person.id));
  }
  assert.equal(layout.nodes.find((node) => node.person.id === "ahmed")?.role, "Отец");
  assert.equal(layout.nodes.find((node) => node.person.id === "magomed")?.role, "");
});

test("clearing selection returns every card to full size without moving any person", () => {
  const family = sampleFamily();
  const focused = buildFamilyOverviewLayout(family, "timur");
  const cleared = buildFamilyOverviewLayout(family, null);
  assert.deepEqual(coordinates(cleared), coordinates(focused));
  assert.ok(cleared.nodes.every((node) => node.size === 188 && !node.isFocus && !node.isContext));
  assert.ok(cleared.nodes.every((node) => node.role === ""));
});

test("overview has exactly the actual relationship edges, deduplicating reversed spouses", () => {
  const family = fixture(["a", "b", "child", "unrelated"], [
    spouse("a", "b"), spouse("b", "a"),
    parent("a", "child"), parent("a", "child"),
    parent("missing", "child"),
  ]);
  const layout = buildFamilyOverviewLayout(family, "child");
  assert.deepEqual(layout.links.map((link) => link.key).sort(), [
    'parent:["a","child"]', 'spouse:["a","b"]',
  ]);
  assert.equal(layout.nodes.length, 4);
  assert.equal(new Set(layout.nodes.map((node) => node.person.id)).size, 4);
});

test("edge endpoints follow the actual compact and expanded card borders", () => {
  const family = sampleFamily();
  for (const focus of ["timur", null]) {
    const layout = buildFamilyOverviewLayout(family, focus);
    const grandfather = layout.nodes.find((node) => node.person.id === "magomed")!;
    const grandmother = layout.nodes.find((node) => node.person.id === "zalikha")!;
    const father = layout.nodes.find((node) => node.person.id === "ahmed")!;
    const edge = parentLink(layout, "magomed", "ahmed");
    assert.ok(edge.d.startsWith(`M ${father.x} `));
    assert.ok(edge.d.endsWith(`V ${father.y - father.size! / 2}`));
    const marriage = layout.links.find((link) => link.key === 'spouse:["magomed","zalikha"]')!;
    const [left, right] = grandfather.x < grandmother.x ? [grandfather, grandmother] : [grandmother, grandfather];
    assert.equal(marriage.d, `M ${left.x + left.size! / 2} ${left.y} H ${right.x - right.size! / 2}`);
    const descent = layout.links.find((link) => link.key.endsWith(":couple") && link.relationshipKeys?.includes('parent:["magomed","ahmed"]'));
    assert.ok(descent?.d.startsWith(`M ${(left.x + right.x) / 2} ${left.y} V `));
  }
});

test("multiple spouses remain visible in one generation without a line through the intervening spouse", () => {
  const family = fixture(["focus", "first", "second", "child-a", "child-b"], [
    spouse("focus", "first"), spouse("focus", "second"),
    parent("focus", "child-a"), parent("first", "child-a"),
    parent("focus", "child-b"), parent("second", "child-b"),
  ]);
  const layout = buildFamilyOverviewLayout(family, "focus");
  const focus = layout.nodes.find((node) => node.person.id === "focus")!;
  assert.ok(layout.nodes.filter((node) => ["first", "second"].includes(node.person.id)).every((node) => node.y === focus.y && node.size === 188));
  const secondMarriage = layout.links.find((link) => link.key === 'spouse:["focus","second"]')!;
  assert.ok(secondMarriage.d.includes(" V "));
  assert.equal(layout.nodes.length, 5);
});

test("crossing branches from different parent sets do not merge into one horizontal bus", () => {
  const family = fixture(["a", "b", "c", "child-ab", "child-ac", "sibling-ab", "child-a"], [
    spouse("a", "b"), spouse("a", "c"),
    parent("a", "child-ab"), parent("b", "child-ab"),
    parent("a", "child-ac"), parent("c", "child-ac"),
    parent("a", "sibling-ab"), parent("b", "sibling-ab"),
    parent("a", "child-a"),
  ]);
  const layout = buildFamilyOverviewLayout(family, "a");
  const lane = (from: string, to: string) => {
    const link = parentLink(layout, from, to);
    return Number(link.d.split(" ")[link.key.startsWith("branch:") ? 2 : 4]);
  };
  assert.equal(lane("a", "child-ab"), lane("b", "child-ab"));
  assert.equal(lane("a", "child-ab"), lane("a", "sibling-ab"));
  assert.notEqual(lane("a", "child-ab"), lane("a", "child-ac"));
  assert.notEqual(lane("a", "child-ab"), lane("a", "child-a"));
  assert.notEqual(lane("a", "child-ac"), lane("a", "child-a"));
  assert.deepEqual(layout.links.map((link) => link.key), buildFamilyOverviewLayout(family, "child-a").links.map((link) => link.key));
});

test("ancestry cycles terminate with finite stable positions and retain actual edges", () => {
  const family = fixture(["a", "b", "c", "child"], [
    parent("a", "b"), parent("b", "c"), parent("c", "a"), parent("c", "child"),
  ]);
  const layout = buildFamilyOverviewLayout(family, "a");
  assert.equal(layout.nodes.length, 4);
  assert.equal(layout.links.length, 4);
  assert.ok(layout.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
  assert.deepEqual(coordinates(layout), coordinates(buildFamilyOverviewLayout(family, null)));
  const cycleRows = layout.nodes.filter((node) => node.person.id !== "child").map((node) => node.y);
  assert.equal(new Set(cycleRows).size, 1);
  assert.ok(layout.nodes.find((node) => node.person.id === "child")!.y > cycleRows[0]);
});

test("empty families return an empty bounded layout", () => {
  assert.deepEqual(buildFamilyOverviewLayout(fixture([], []), null), {
    nodes: [], links: [], width: 0, height: 0, nodeSize: 188,
  });
});

function twoFamilyWedding() {
  return fixture(["rauf", "ayten", "adalat", "esmira", "farida", "zaladdin", "emilia", "avsaddin"], [
    spouse("rauf", "ayten"), spouse("adalat", "esmira"), spouse("zaladdin", "emilia"),
    parent("rauf", "farida"), parent("ayten", "farida"), parent("rauf", "emilia"), parent("ayten", "emilia"),
    parent("adalat", "zaladdin"), parent("esmira", "zaladdin"), parent("adalat", "avsaddin"), parent("esmira", "avsaddin"),
  ]);
}

test("the eight-person wedding joins the families with each spouse facing their own parents", () => {
  const family = twoFamilyWedding();
  const layout = buildFamilyOverviewLayout(family, null);
  const rows = [...new Set(layout.nodes.map((node) => node.y))].sort((a, b) => a - b);
  assert.equal(rows.length, 2);
  const rowIds = (y: number) => layout.nodes.filter((node) => node.y === y).sort((a, b) => a.x - b.x).map((node) => node.person.id);
  assert.deepEqual(rowIds(rows[0]), ["rauf", "ayten", "adalat", "esmira"]);
  assert.deepEqual(rowIds(rows[1]), ["farida", "emilia", "zaladdin", "avsaddin"]);
  for (const person of family.people) {
    assert.deepEqual(coordinates(buildFamilyOverviewLayout(family, person.id)), coordinates(layout));
  }
  const buses = layout.links.filter((link) => link.key.endsWith(":bus"));
  assert.equal(buses.length, 2, "one descent/bus per exact parent pair, not one overlapping path per edge");
  assert.equal(layout.links.filter((link) => link.key.endsWith(":couple")).length, 2);
  const extents = buses.map((link) => {
    const tokens = link.d.split(" ");
    return { left: Number(tokens[1]), right: Number(tokens[4]) };
  }).sort((a, b) => a.left - b.left);
  assert.ok(extents[0].right < extents[1].left, "the two parental branches must not cross or overlap");
});

test("shared geometry retains exactly the actual deduplicated relationship graph", () => {
  for (const family of [sampleFamily(), twoFamilyWedding(), fixture(["a", "b", "c", "x", "y"], [
    spouse("a", "b"), spouse("a", "c"), spouse("c", "a"),
    parent("a", "x"), parent("b", "x"), parent("a", "y"), parent("a", "y"), parent("missing", "y"),
  ])]) {
    const valid = new Set(family.people.map((person) => person.id));
    const expected = new Set(family.relationships.filter((edge) => valid.has(edge.fromPersonId) && valid.has(edge.toPersonId)).map((edge) => {
      const pair = [edge.fromPersonId, edge.toPersonId];
      if (edge.type === "spouse") pair.sort();
      return `${edge.type}:${JSON.stringify(pair)}`;
    }));
    for (const focus of [null, family.people[0].id]) {
      const layout = buildFamilyOverviewLayout(family, focus);
      assert.ok(layout.links.every((link) => link.relationshipKeys?.length));
      assert.deepEqual([...new Set(layout.links.flatMap((link) => link.relationshipKeys!))].sort(), [...expected].sort());
      assert.equal(new Set(layout.links.map((link) => link.key)).size, layout.links.length);
    }
  }
});

test("a spouse is never drawn as a co-parent without their recorded child edge", () => {
  const layout = buildFamilyOverviewLayout(fixture(["a", "b", "child"], [spouse("a", "b"), parent("a", "child")]), null);
  assert.equal(layout.links.some((link) => link.key.endsWith(":couple")), false);
  const source = layout.nodes.find((node) => node.person.id === "a")!;
  assert.ok(parentLink(layout, "a", "child").d.startsWith(`M ${source.x} ${source.y + source.size! / 2} `));
  assert.equal(layout.links.flatMap((link) => link.relationshipKeys!).includes('parent:["b","child"]'), false);
});

test("unmarried co-parents connect below the cards without an invented marriage junction", () => {
  const layout = buildFamilyOverviewLayout(fixture(["a", "b", "child"], [parent("a", "child"), parent("b", "child")]), null);
  assert.equal(layout.links.some((link) => link.key.startsWith("spouse:") || link.key.endsWith(":couple")), false);
  for (const id of ["a", "b"]) {
    const node = layout.nodes.find((person) => person.person.id === id)!;
    const stem = layout.links.find((link) => link.key.endsWith(`:parent:${id}`));
    assert.ok(stem?.d.startsWith(`M ${node.x} ${node.y + node.size! / 2} V `));
  }
});

test("half siblings and different marriages never share a child-set bus", () => {
  const family = fixture(["a", "b", "c", "ab1", "ab2", "ac", "a-only"], [
    spouse("a", "b"), spouse("a", "c"),
    parent("a", "ab1"), parent("b", "ab1"), parent("a", "ab2"), parent("b", "ab2"),
    parent("a", "ac"), parent("c", "ac"), parent("a", "a-only"),
  ]);
  const layout = buildFamilyOverviewLayout(family, null);
  const shared = layout.links.find((link) => link.key.endsWith(":bus") && link.relationshipKeys?.includes('parent:["a","ab1"]'))!;
  assert.ok(shared);
  assert.deepEqual([...shared.relationshipKeys!].sort(), [
    'parent:["a","ab1"]', 'parent:["a","ab2"]', 'parent:["b","ab1"]', 'parent:["b","ab2"]',
  ]);
  const nonAdjacentSpouse = layout.links.find((link) => link.key === 'spouse:["a","c"]')!;
  assert.ok(nonAdjacentSpouse.d.includes(" V "));
  assert.equal(layout.links.some((link) => link.key.endsWith(":couple") && link.relationshipKeys?.includes('parent:["c","ac"]')), false);
});

test("mixed-generation parents keep their actual individual edges and the long edge uses an outside rail", () => {
  const family = fixture(["grandparent", "parent", "child"], [
    parent("grandparent", "parent"), parent("parent", "child"), parent("grandparent", "child"),
  ]);
  const layout = buildFamilyOverviewLayout(family, null);
  const edge = parentLink(layout, "grandparent", "child");
  const railX = Number(edge.d.split(" ")[6]);
  assert.ok(railX > Math.max(...layout.nodes.map((node) => node.x + node.size! / 2))
    || railX < Math.min(...layout.nodes.map((node) => node.x - node.size! / 2)));
  assert.deepEqual(edge.relationshipKeys, ['parent:["grandparent","child"]']);
  assert.ok(layout.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
  assert.equal(layout.links.some((link) => link.key.endsWith(":couple")), false);
});

test("dense parent sets receive additional vertical space independent of selection", () => {
  const coParents = Array.from({ length: 8 }, (_, index) => `parent-${index}`);
  const children = Array.from({ length: 8 }, (_, index) => `child-${index}`);
  const family = fixture(["a", ...coParents, ...children], coParents.flatMap((id, index) => [
    spouse("a", id), parent("a", children[index]), parent(id, children[index]),
  ]));
  const layout = buildFamilyOverviewLayout(family, null);
  const a = layout.nodes.find((node) => node.person.id === "a")!;
  const child = layout.nodes.find((node) => node.person.id === children[0])!;
  assert.ok(child.y - a.y >= 188 + 72 + 8 * 18);
  const focused = buildFamilyOverviewLayout(family, children[0]);
  assert.deepEqual(coordinates(focused), coordinates(layout));
  assert.equal(focused.height, layout.height);
});
