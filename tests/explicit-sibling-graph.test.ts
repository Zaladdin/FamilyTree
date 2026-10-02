import test from "node:test";
import assert from "node:assert/strict";
import { getFamilyBySlug } from "@/lib/mock-data";
import { getFamilyKinship } from "@/lib/family-kinship";
import { getFocusRelatives, buildFamilyTreeLayout } from "@/lib/family-utils";
import { buildFamilyDisplayLayout } from "@/lib/family-display-layout";
import { buildFamilyRadialLayout } from "@/lib/family-radial-layout";
import { buildFamilyPyramidLayout } from "@/lib/family-pyramid-layout";
import { buildFamilyOverviewLayout } from "@/lib/family-overview-layout";
import { repositionFamilyLayout } from "@/lib/family-node-positions";
import { getFamilyExportBranch } from "@/lib/family-export-branch";
import { buildFamilyTreeExport } from "@/lib/family-tree-export";
import type { Family, FamilyRelationship } from "@/lib/types";

const edge = (type: FamilyRelationship["type"], fromPersonId: string, toPersonId: string): FamilyRelationship => ({ type, fromPersonId, toPersonId });
function fixture(ids: string[], relationships: FamilyRelationship[]): Family {
  const sample = structuredClone(getFamilyBySlug("akhmedov")!);
  return { ...sample, people: ids.map((id) => ({ ...structuredClone(sample.people[0]), id, firstName: id, gender: /^(aunt(?:-[ab])?|sister|wife|niece)$/.test(id) ? "female" : "male" })), archivedPeople: [], relationships };
}

test("explicit siblings work without parents and derive aunt/nephew from recorded edges", () => {
  const data = fixture(["me", "father", "aunt-a", "aunt-b"], [edge("parent", "father", "me"), edge("sibling", "father", "aunt-a"), edge("sibling", "aunt-b", "father")]);
  assert.deepEqual(getFocusRelatives(data, "father").siblings.map((person) => person.id).sort(), ["aunt-a", "aunt-b"]);
  assert.deepEqual(getFamilyKinship(data, "me").get("aunt-a"), { label: "Тётя", pathIds: ["me", "father", "aunt-a"], distance: 2 });
  assert.equal(getFamilyKinship(data, "father").get("aunt-b")?.label, "Сестра");
  assert.equal(getFamilyKinship(data, "aunt-a").get("me")?.label, "Племянник");
  assert.equal(getFamilyKinship(data, "aunt-a").has("aunt-b"), false, "sibling chains cannot establish a shared parent");
});

test("direct sibling in-laws use two-edge witnesses without inventing parenthood", () => {
  const data = fixture(["me", "wife", "her-brother", "sister", "sister-husband", "niece", "sister-parent"], [edge("spouse", "me", "wife"), edge("sibling", "wife", "her-brother"), edge("sibling", "sister", "me"), edge("spouse", "sister", "sister-husband"), edge("parent", "sister", "niece"), edge("parent", "sister-parent", "sister")]);
  const kinship = getFamilyKinship(data, "me");
  assert.equal(kinship.get("her-brother")?.label, "Брат жены");
  assert.equal(kinship.get("sister-husband")?.label, "Муж сестры");
  assert.equal(kinship.get("niece")?.label, "Племянница");
  assert.equal(kinship.has("sister-parent"), false);
  assert.deepEqual(getFocusRelatives(data, "me").parents, []);
});

test("duplicate/reversed sibling facts remain deterministic and archived intermediates are excluded", () => {
  const data = fixture(["me", "father", "aunt", "sister", "shared-parent"], [edge("parent", "father", "me"), edge("sibling", "aunt", "father"), edge("sibling", "father", "aunt"), edge("sibling", "me", "sister"), edge("parent", "shared-parent", "me"), edge("parent", "shared-parent", "sister")]);
  const before = structuredClone(data);
  assert.deepEqual(getFamilyKinship(data, "me").get("sister")?.pathIds, ["me", "sister"]);
  assert.equal(getFocusRelatives(data, "me").siblings.length, 1);
  assert.deepEqual([...getFamilyKinship({ ...data, people: [...data.people].reverse(), relationships: [...data.relationships].reverse() }, "me")], [...getFamilyKinship(data, "me")]);
  assert.deepEqual(data, before);
  data.people.find((person) => person.id === "father")!.isArchived = true;
  assert.equal(getFamilyKinship(data, "me").has("aunt"), false);
});

test("radial and pyramid retain canonical typed sibling lines at their respective card borders after dragging", () => {
  const data = fixture(["me", "father", "aunt"], [edge("parent", "father", "me"), edge("sibling", "father", "aunt"), edge("sibling", "aunt", "father")]);
  for (const build of [buildFamilyRadialLayout, buildFamilyPyramidLayout]) {
    const layout = build(data, "me");
    assert.equal(layout.links.length, 2);
    assert.deepEqual(build({ ...data, people: [...data.people].reverse(), relationships: [...data.relationships].reverse() }, "me"), layout);
    const moved = repositionFamilyLayout(layout, { aunt: { x: 25, y: 10 } }, data.relationships);
    const link = moved.links.find((item) => item.key === 'sibling:["aunt","father"]')!;
    assert.ok(link);
    assert.equal(link.type, "sibling");
    assert.deepEqual(link.relationshipKeys, [link.key]);
    assert.notEqual(link.d, layout.links.find((item) => item.key === link.key)!.d);
    const coordinates = link.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    if (layout.connectionStyle === "orthogonal") {
      assert.ok(!/[QC]/.test(link.d));
      const endpoints = moved.nodes.filter(node => ["aunt", "father"].includes(node.person.id)).sort((a, b) => a.x - b.x);
      assert.equal(coordinates[0], endpoints[0].x + endpoints[0].width! / 2);
      assert.equal(coordinates[1], endpoints[0].y);
      assert.equal(coordinates.at(-2), endpoints[1].x - endpoints[1].width! / 2);
      assert.equal(coordinates.at(-1), endpoints[1].y);
    } else {
      assert.equal(coordinates.length, 6);
      for (const [id, offset] of [["aunt", 0], ["father", 4]] as const) {
        const node = moved.nodes.find((item) => item.person.id === id)!;
        assert.ok(Math.abs(Math.hypot(coordinates[offset] - node.x, coordinates[offset + 1] - node.y) - node.size! / 2) < 0.01);
      }
    }
  }
});

test("explicit sibling is full-sized and hidden-others keeps an aunt and her recorded parent witness", () => {
  const data = fixture(["me", "father", "aunt", "stranger"], [edge("parent", "father", "me"), edge("sibling", "father", "aunt")]);
  assert.equal(buildFamilyRadialLayout(data, "father").nodes.find((node) => node.person.id === "aunt")?.isContext, false);
  for (const mode of ["radial", "pyramid"] as const) {
    const layout = buildFamilyDisplayLayout(data, "me", true, undefined, mode);
    assert.deepEqual(layout.nodes.map((node) => node.person.id).sort(), ["aunt", "father", "me"]);
    assert.equal(layout.nodes.find((node) => node.person.id === "aunt")?.role, "Тётя");
    assert.equal(layout.links.length, 2);
  }
});

test("overview, pyramid and legacy focus layouts retain sibling facts without drawing marriages", () => {
  const data = fixture(["me", "father", "aunt", "grandfather"], [edge("parent", "father", "me"), edge("parent", "grandfather", "aunt"), edge("sibling", "father", "aunt")]);
  for (const build of [buildFamilyOverviewLayout, buildFamilyPyramidLayout]) {
    const layout = build(data, "me");
    assert.equal(layout.nodes.find((node) => node.person.id === "father")!.y, layout.nodes.find((node) => node.person.id === "aunt")!.y);
    assert.ok(layout.nodes.find((node) => node.person.id === "grandfather")!.y < layout.nodes.find((node) => node.person.id === "father")!.y);
    assert.ok(layout.links.some((link) => link.key === 'sibling:["aunt","father"]'));
    assert.ok(layout.links.every((link) => !link.key.startsWith("spouse:")));
  }
  assert.ok(buildFamilyTreeLayout(data, "father").links.some((link) => link.key === 'sibling:["aunt","father"]'));
});

test("export adds recorded siblings of the ancestor branch and their descendants, not their unrelated parents or sibling chains", () => {
  const data = fixture(["me", "father", "aunt", "cousin", "aunt-spouse", "aunt-parent", "aunt-other-sibling"], [edge("parent", "father", "me"), edge("sibling", "father", "aunt"), edge("parent", "aunt", "cousin"), edge("spouse", "aunt", "aunt-spouse"), edge("parent", "aunt-parent", "aunt"), edge("sibling", "aunt", "aunt-other-sibling")]);
  const branch = getFamilyExportBranch(data, "me");
  assert.deepEqual(branch.rootIds, ["father"]);
  assert.deepEqual(branch.family.people.map((person) => person.id).sort(), ["aunt", "aunt-spouse", "cousin", "father", "me"]);
  assert.equal(branch.family.relationships.length, 4);
});

test("all export styles retain sibling facts and a distinct sibling legend", () => {
  const data = fixture(["me", "father", "aunt"], [edge("parent", "father", "me"), edge("sibling", "father", "aunt")]);
  for (const style of ["circle", "pyramid", "tree"] as const) {
    const result = buildFamilyTreeExport(data, buildFamilyRadialLayout(data, "me"), style, "me");
    assert.equal(result.peopleCount, 3);
    const keys = [...result.svg.matchAll(/data-relationship-keys="([^"]*)"/g)].flatMap((match) => JSON.parse(match[1].replace(/&quot;/g, '"')) as string[]);
    assert.ok(keys.includes('sibling:["aunt","father"]'));
    assert.equal(keys.some((key) => key.startsWith("spouse:")), false);
    assert.match(result.svg, /Братья и сёстры/);
  }
});
