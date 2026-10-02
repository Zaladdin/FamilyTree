import test from "node:test";
import assert from "node:assert/strict";
import { buildFamilyDisplayLayout } from "@/lib/family-display-layout";
import { getFamilyKinship } from "@/lib/family-kinship";
import { getFamilyBySlug } from "@/lib/mock-data";
import type { Family, FamilyRelationship, Gender } from "@/lib/types";

function parent(fromPersonId: string, toPersonId: string): FamilyRelationship {
  return { type: "parent", fromPersonId, toPersonId };
}

function spouse(fromPersonId: string, toPersonId: string): FamilyRelationship {
  return { type: "spouse", fromPersonId, toPersonId };
}

function fixture(): Family {
  const sample = getFamilyBySlug("akhmedov");
  assert.ok(sample);
  const family = structuredClone(sample);
  const template = family.people[0];
  const people: Array<[string, Gender]> = [
    ["wife-father", "male"], ["wife-mother", "female"], ["father", "male"], ["mother", "female"],
    ["focus", "male"], ["wife", "female"], ["wife-brother", "male"], ["sister", "female"],
    ["wife-brother-wife", "female"], ["farther-parent", "male"], ["unrelated", "female"],
  ];
  family.people = people.map(([id, gender]) => ({ ...template, id, firstName: id, gender, isArchived: false, mediaAssets: [], stories: [] }));
  family.archivedPeople = [];
  family.relationships = [
    spouse("wife-father", "wife-mother"), spouse("father", "mother"), spouse("focus", "wife"),
    parent("wife-father", "wife"), parent("wife-mother", "wife"),
    parent("wife-father", "wife-brother"), parent("wife-mother", "wife-brother"),
    parent("father", "focus"), parent("mother", "focus"), parent("father", "sister"), parent("mother", "sister"),
    spouse("wife-brother", "wife-brother-wife"), parent("farther-parent", "wife-brother-wife"),
  ];
  family.stats.people = family.people.length;
  return family;
}

function coordinates(layout: ReturnType<typeof buildFamilyDisplayLayout>) {
  return layout.nodes.map((node) => ({ id: node.person.id, x: node.x, y: node.y }));
}

function relationshipKey(relationship: FamilyRelationship) {
  const ids = [relationship.fromPersonId, relationship.toPersonId];
  return `${relationship.type}:${JSON.stringify(relationship.type === "spouse" ? ids.sort() : ids)}`;
}

function representedRelationships(layout: ReturnType<typeof buildFamilyDisplayLayout>) {
  assert.ok(layout.links.every((link) => link.relationshipKeys?.length), "every drawn segment must identify its recorded relationships");
  return [...new Set(layout.links.flatMap((link) => link.relationshipKeys ?? []))].sort();
}

test("full display puts derived kinship labels on compact in-law cards without inventing labels for unsupported paths", () => {
  const family = fixture();
  const layout = buildFamilyDisplayLayout(family, "focus");
  assert.equal(layout.nodes.length, family.people.length);
  for (const [id, label] of [["wife-father", "Тесть"], ["wife-mother", "Тёща"], ["wife-brother", "Брат жены"]]) {
    const node = layout.nodes.find((item) => item.person.id === id);
    assert.ok(node);
    assert.equal(node.role, label);
    assert.equal(node.size, 124);
    assert.equal(node.isContext, true);
  }
  for (const id of ["wife-brother-wife", "farther-parent", "unrelated"]) {
    assert.equal(layout.nodes.find((node) => node.person.id === id)?.role, "");
  }
  assert.equal(layout.nodes.find((node) => node.person.id === "father")?.role, "Отец");
  assert.equal(layout.nodes.find((node) => node.person.id === "wife")?.role, "Жена");
  assert.deepEqual(layout.nodes.filter((node) => node.isFocus).map((node) => node.person.id), ["focus"]);
});

test("without a perspective everyone is full-sized and no relative labels or selection remain", () => {
  const family = fixture();
  for (const hideOthers of [false, true]) {
    const layout = buildFamilyDisplayLayout(family, null, hideOthers);
    assert.equal(layout.nodes.length, family.people.length);
    assert.ok(layout.nodes.every((node) => node.size === 188 && !node.isContext && !node.isFocus && node.role === ""));
  }
});

test("changing perspective centers that person in a circular tree and returns to the same geometry", () => {
  const family = fixture();
  const overview = buildFamilyDisplayLayout(family, null);
  for (const id of family.people.map((person) => person.id)) {
    const layout = buildFamilyDisplayLayout(family, id);
    const focus = layout.nodes.find((node) => node.person.id === id);
    assert.ok(focus);
    assert.equal(layout.width, layout.height, "radial canvas has equal extents");
    assert.equal(focus.x, layout.width / 2);
    assert.equal(focus.y, layout.height / 2);
    assert.deepEqual(coordinates(layout), coordinates(buildFamilyDisplayLayout(family, id)));
    assert.deepEqual(coordinates(buildFamilyDisplayLayout(family, null)), coordinates(overview));
  }
  const wifePerspective = buildFamilyDisplayLayout(family, "wife");
  assert.equal(wifePerspective.nodes.find((node) => node.person.id === "father")?.role, "Свёкор");
  assert.equal(wifePerspective.nodes.find((node) => node.person.id === "mother")?.role, "Свекровь");
  assert.equal(wifePerspective.nodes.find((node) => node.person.id === "sister")?.role, "Сестра мужа");
});

test("close display retains in-laws and full-size recorded paths while hiding unrelated and unsupported branches", () => {
  const family = fixture();
  const layout = buildFamilyDisplayLayout(family, "focus", true);
  const expectedIds = ["focus", "wife", "father", "mother", "sister", "wife-father", "wife-mother", "wife-brother"].sort();
  assert.deepEqual(layout.nodes.map((node) => node.person.id).sort(), expectedIds);
  assert.ok(layout.nodes.every((node) => node.size === 188 && !node.isContext));
  assert.equal(layout.nodes.find((node) => node.person.id === "wife-father")?.role, "Тесть");
  const visible = new Set(expectedIds);
  const recordedEdges = family.relationships.filter((edge) => visible.has(edge.fromPersonId) && visible.has(edge.toPersonId));
  assert.equal(recordedEdges.length, 11);
  assert.deepEqual(representedRelationships(layout), recordedEdges.map(relationshipKey).sort());
  assert.deepEqual(layout.nodes.filter((node) => node.isFocus).map((node) => node.person.id), ["focus"]);
});

test("a retained derived relationship keeps its intermediate spouse even when that spouse has no displayed label", () => {
  const family = fixture();
  const relation = getFamilyKinship(family, "focus").get("wife-father");
  assert.ok(relation);
  const kinship = new Map([["wife-father", relation]]);
  const layout = buildFamilyDisplayLayout(family, "focus", true, kinship);
  assert.deepEqual(layout.nodes.map((node) => node.person.id).sort(), ["focus", "wife", "wife-father"]);
  assert.equal(layout.nodes.find((node) => node.person.id === "wife")?.role, "");
  assert.deepEqual(representedRelationships(layout), [
    relationshipKey(spouse("focus", "wife")), relationshipKey(parent("wife-father", "wife")),
  ].sort());
  assert.ok(layout.nodes.every((node) => node.size === 188 && !node.isContext));
  assert.equal(kinship.size, 1);
});

test("invalid perspective safely falls back to an unselected full-family overview", () => {
  const family = fixture();
  const expected = buildFamilyDisplayLayout(family, null);
  for (const hideOthers of [false, true]) {
    const layout = buildFamilyDisplayLayout(family, "missing-person", hideOthers);
    assert.deepEqual(layout, expected);
  }
});

test("deriving full and close display layouts never mutates the family or its relationships", () => {
  const family = fixture();
  const before = structuredClone(family);
  function freeze(value: unknown) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  freeze(family);
  for (const perspective of [null, "focus", "wife", "missing-person"]) {
    for (const hideOthers of [false, true]) buildFamilyDisplayLayout(family, perspective, hideOthers);
  }
  assert.deepEqual(family, before);
});

test("pyramid display is opt-in, keeps kinship and preserves filtering through recorded paths", () => {
  const family = fixture();
  const radial = buildFamilyDisplayLayout(family, "focus");
  assert.deepEqual(buildFamilyDisplayLayout(family, "focus", false, undefined, "radial"), radial);
  const full = buildFamilyDisplayLayout(family, "focus", false, undefined, "pyramid");
  assert.ok("pyramidOutline" in full && full.pyramidOutline);
  assert.equal(full.nodes.length, family.people.length);
  assert.equal(full.nodes.find((node) => node.person.id === "wife-father")?.role, "Тесть");
  assert.equal(full.nodes.find((node) => node.person.id === "wife-father")?.size, 124);
  const close = buildFamilyDisplayLayout(family, "focus", true, undefined, "pyramid");
  assert.deepEqual(close.nodes.map((node) => node.person.id).sort(), buildFamilyDisplayLayout(family, "focus", true).nodes.map((node) => node.person.id).sort());
  assert.ok(close.nodes.every((node) => node.size === 188 && !node.isContext));
  assert.deepEqual(representedRelationships(close), representedRelationships(buildFamilyDisplayLayout(family, "focus", true)));
  assert.deepEqual(buildFamilyDisplayLayout(family, "missing", true, undefined, "pyramid"), buildFamilyDisplayLayout(family, null, false, undefined, "pyramid"));
});

for (const mode of ["generations", "horizontal"] as const) {
  test(`${mode} aligns generations, preserves relationships and filters deterministically`, () => {
    const family = fixture();
    const layout = buildFamilyDisplayLayout(family, null, false, undefined, mode);
    const axis = mode === "horizontal" ? "x" : "y";
    const byId = new Map(layout.nodes.map((node) => [node.person.id, node]));
    assert.equal(byId.get("father")![axis], byId.get("mother")![axis]);
    assert.ok(byId.get("father")![axis] < byId.get("focus")![axis]);
    assert.equal("pyramidOutline" in layout, false);
    assert.deepEqual(representedRelationships(layout), family.relationships.map(relationshipKey).sort());
    for (const link of layout.links) {
      const values = link.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      assert.ok(values.every(Number.isFinite));
      assert.ok(!/[QC]/.test(link.d));
      if (link.type === "parent") for (const key of link.relationshipKeys!) {
        const [, childId] = JSON.parse(key.slice(key.indexOf(":") + 1)) as string[];
        const child = byId.get(childId)!;
        const port = mode === "horizontal" ? `${child.x - child.width! / 2} ${child.y}` : `${child.x} ${child.y - child.height! / 2}`;
        assert.ok(link.d.includes(port), "every recorded child has a card-edge connector");
      }
    }
    assert.deepEqual(coordinates(layout), coordinates(buildFamilyDisplayLayout({ ...family, people: [...family.people].reverse(), relationships: [...family.relationships].reverse() }, null, false, undefined, mode)));
    const close = buildFamilyDisplayLayout(family, "focus", true, undefined, mode);
    assert.deepEqual(representedRelationships(close), representedRelationships(buildFamilyDisplayLayout(family, "focus", true)));
    assert.ok(close.nodes.every((node) => node.size === 188));
    assert.deepEqual(coordinates(close), coordinates(buildFamilyDisplayLayout(family, "focus", true, undefined, mode)));
    assert.deepEqual(buildFamilyDisplayLayout(family, "missing", true, undefined, mode), layout);
    assert.ok(layout.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)
      && node.x >= node.width! / 2 && node.x + node.width! / 2 <= layout.width
      && node.y >= node.height! / 2 && node.y + node.height! / 2 <= layout.height));
    const rows = new Map<number, number[]>();
    const crossAxis = mode === "horizontal" ? "y" : "x";
    for (const node of layout.nodes) rows.set(node[axis], [...(rows.get(node[axis]) ?? []), node[crossAxis]]);
    for (const positions of rows.values()) {
      positions.sort((a, b) => a - b);
      for (let index = 1; index < positions.length; index++) assert.equal(positions[index] - positions[index - 1], mode === "horizontal" ? 160 : 284);
    }
    const empty = buildFamilyDisplayLayout({ ...family, people: [], relationships: [] }, null, false, undefined, mode);
    assert.equal(empty.width, 0);
    assert.equal(empty.nodes.length, 0);
  });
}
