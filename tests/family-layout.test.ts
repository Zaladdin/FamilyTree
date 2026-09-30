import test from "node:test";
import assert from "node:assert/strict";
import { buildFamilyTreeLayout, getFocusRelatives } from "@/lib/family-utils";
import type { Family, FamilyPerson, FamilyRelationship } from "@/lib/types";

function person(id: string): FamilyPerson {
  return {
    id,
    firstName: id,
    lastName: "Тестовая семья",
    gender: "male",
    birthDate: "1990",
    birthPlace: "",
    status: "living",
    isArchived: false,
    biography: "",
    timeline: [],
    media: { photos: 0, audio: 0, documents: 0 },
    mediaAssets: [],
    stories: [],
  };
}

function parent(fromPersonId: string, toPersonId: string): FamilyRelationship {
  return { type: "parent", fromPersonId, toPersonId };
}

function spouse(fromPersonId: string, toPersonId: string): FamilyRelationship {
  return { type: "spouse", fromPersonId, toPersonId };
}

function family(ids: string[], relationships: FamilyRelationship[]): Family {
  return {
    id: "layout-fixture",
    slug: "layout-fixture",
    title: "Тестовое дерево",
    surname: "Тестовая семья",
    description: "",
    region: "",
    coverQuote: "",
    stats: { people: ids.length, photos: 0, audio: 0, stories: 0, contributors: 0 },
    memberships: [],
    digitizationQueue: [],
    people: ids.map(person),
    archivedPeople: [],
    relationships,
    auditLog: [],
  };
}

function node(layout: ReturnType<typeof buildFamilyTreeLayout>, id: string) {
  const result = layout.nodes.find((item) => item.person.id === id);
  assert.ok(result, `missing node ${id}`);
  return result;
}

function link(layout: ReturnType<typeof buildFamilyTreeLayout>, key: string) {
  const result = layout.links.find((item) => item.key === key);
  assert.ok(result, `missing link ${key}`);
  return result;
}

test("ordinary full siblings share the actual parents' branch with no gap below the couple", () => {
  const sample = family(["focus", "father", "mother", "sibling"], [
    spouse("father", "mother"),
    parent("father", "focus"), parent("mother", "focus"),
    parent("father", "sibling"), parent("mother", "sibling"),
  ]);
  const layout = buildFamilyTreeLayout(sample, "focus");
  const father = node(layout, "father");
  const mother = node(layout, "mother");
  assert.ok(link(layout, "ancestors-drop").d.startsWith(`M ${(father.x + mother.x) / 2} ${father.y} V `));
  assert.ok(link(layout, "ancestors-branch-1").d.startsWith(`M ${node(layout, "sibling").x} `));
  assert.equal(layout.nodeSize, 188);
  assert.equal(new Set(layout.links.map((item) => item.key)).size, layout.links.length);
});

test("a half sibling is linked only to the shared parent, not the focus person's other parent", () => {
  const sample = family(["focus", "father", "mother", "half", "other-parent"], [
    spouse("father", "mother"),
    parent("father", "focus"), parent("mother", "focus"),
    parent("father", "half"), parent("other-parent", "half"),
  ]);
  const layout = buildFamilyTreeLayout(sample, "focus");
  assert.equal(layout.links.some((item) => item.key === "ancestors-branch-1"), false);
  const father = node(layout, "father");
  assert.ok(link(layout, "ancestors-1-drop").d.startsWith(`M ${father.x} ${father.y + 86} V `));
  assert.ok(link(layout, "ancestors-1-branch-0").d.startsWith(`M ${node(layout, "half").x} `));
});

test("all spouses are visible and children from different marriages have separate actual parent groups", () => {
  const sample = family(["focus", "first", "second", "child-a", "child-b", "child-alone"], [
    spouse("focus", "first"), spouse("second", "focus"),
    parent("focus", "child-a"), parent("first", "child-a"),
    parent("focus", "child-b"), parent("second", "child-b"),
    parent("focus", "child-alone"),
  ]);
  const layout = buildFamilyTreeLayout(sample, "focus");
  assert.ok(node(layout, "first"));
  assert.ok(node(layout, "second"));
  assert.equal(layout.links.some((item) => item.key === "descendants-branch-1"), false);
  assert.ok(link(layout, "descendants-branch-0").d.startsWith(`M ${node(layout, "child-a").x} `));
  assert.ok(link(layout, "descendants-1-branch-0").d.startsWith(`M ${node(layout, "child-b").x} `));
  const focus = node(layout, "focus");
  assert.ok(link(layout, "descendants-2-drop").d.startsWith(`M ${focus.x} ${focus.y + 86} V `));
  assert.ok(link(layout, "descendants-2-branch-0").d.startsWith(`M ${node(layout, "child-alone").x} `));
  const spouseLinks = layout.links.filter((item) => item.key.startsWith("spouse:"));
  assert.equal(spouseLinks.length, 2);
  assert.ok(spouseLinks.some((item) => item.d.includes(" V ")), "non-adjacent spouses need a route around the intervening card");
});

test("a spouse is not inferred to be the parent of a child with only one recorded parent", () => {
  const sample = family(["focus", "partner", "child"], [
    spouse("focus", "partner"), parent("focus", "child"),
  ]);
  const layout = buildFamilyTreeLayout(sample, "focus");
  const focus = node(layout, "focus");
  assert.ok(link(layout, "descendants-drop").d.startsWith(`M ${focus.x} ${focus.y + 86} V `));
  assert.ok(link(layout, "descendants-bus"), "the off-centre child needs a horizontal connection to its parent");
});

test("two co-parents without a spouse relationship are not presented as a married pair", () => {
  const sample = family(["focus", "parent-a", "parent-b"], [
    parent("parent-a", "focus"), parent("parent-b", "focus"),
  ]);
  const layout = buildFamilyTreeLayout(sample, "focus");
  assert.equal(layout.links.some((item) => item.key.startsWith("spouse:")), false);
  assert.equal(layout.links.some((item) => item.key === "ancestors-couple"), false);
  for (const [index, id] of ["parent-a", "parent-b"].entries()) {
    const source = node(layout, id);
    assert.ok(link(layout, `ancestors-parent-${index}`).d.startsWith(`M ${source.x} ${source.y + 86} V `));
  }
});

test("duplicate and reversed relationship records do not duplicate people or links", () => {
  const sample = family(["focus", "partner", "child"], [
    spouse("focus", "partner"), spouse("partner", "focus"),
    parent("focus", "child"), parent("focus", "child"), parent("partner", "child"),
  ]);
  const relatives = getFocusRelatives(sample, "focus");
  assert.equal(relatives.spouses.length, 1);
  assert.equal(relatives.children.length, 1);
  const layout = buildFamilyTreeLayout(sample, "focus");
  assert.equal(layout.nodes.length, 3);
  assert.equal(new Set(layout.links.map((item) => item.key)).size, layout.links.length);
});

test("empty and unrelated families have no invented links or invalid coordinates", () => {
  assert.deepEqual(buildFamilyTreeLayout(family([], []), "missing"), {
    nodes: [], links: [], width: 0, height: 0, nodeSize: 188,
  });
  const layout = buildFamilyTreeLayout(family(["focus", "unrelated"], [parent("missing", "focus")]), "focus");
  assert.equal(layout.nodes.length, 1);
  assert.equal(layout.links.length, 0);
  assert.equal(layout.width, 488);
  assert.equal(layout.height, 488);
});
