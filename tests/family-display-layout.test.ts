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
