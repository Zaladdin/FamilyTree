import test from "node:test";
import assert from "node:assert/strict";
import { addPersonToFamily, getSharedChildrenCandidates, type AddPersonInput } from "@/lib/family-logic";
import { buildFamilyOverviewLayout } from "@/lib/family-overview-layout";
import { getFocusRelatives } from "@/lib/family-utils";
import { buildFamilyDisplayLayout } from "@/lib/family-display-layout";
import { getFamilyBySlug } from "@/lib/mock-data";
import { parseAddPersonInput } from "@/lib/request-validation";
import type { Family } from "@/lib/types";

function fixture(): Family {
  const sample = getFamilyBySlug("akhmedov");
  assert.ok(sample);
  return {
    ...structuredClone(sample),
    people: ["father", "child", "other-child", "unrelated", "other-parent"].map((id) => ({
      ...structuredClone(sample.people[0]), id, firstName: id, isArchived: false,
    })),
    archivedPeople: [],
    relationships: [
      { type: "parent", fromPersonId: "father", toPersonId: "child" },
      { type: "parent", fromPersonId: "father", toPersonId: "other-child" },
    ],
  };
}

const input: AddPersonInput = {
  firstName: "Мама", lastName: "Тестовая", gender: "female", birthDate: "1970",
  birthPlace: "Тест", relationshipKind: "spouse", relativePersonId: "father",
};

test("adding a mother records selected and automatically inferred children and renders them", () => {
  const family = fixture();
  const before = structuredClone(family);
  const result = addPersonToFamily(family, { ...input, sharedChildIds: ["child"] });
  assert.deepEqual(family, before, "creation must not mutate its input");
  assert.deepEqual(getFocusRelatives(result.family, "child").parents.map((p) => p.id).sort(), ["father", result.person.id].sort());
  assert.equal(result.family.relationships.length, family.relationships.length + 3);
  assert.ok(result.family.relationships.some((r) => r.type === "spouse" && r.fromPersonId === "father" && r.toPersonId === result.person.id));
  const layout = buildFamilyOverviewLayout(result.family, "father");
  assert.ok(layout.links.some((link) => link.relationshipKeys?.includes(`parent:${JSON.stringify([result.person.id, "child"])}`)));
  assert.ok(layout.links.some((link) => link.relationshipKeys?.includes(`parent:${JSON.stringify([result.person.id, "other-child"])}`)));
  const closeLayout = buildFamilyDisplayLayout(result.family, "father", true);
  for (const parentId of ["father", result.person.id]) {
    const key = `parent:${JSON.stringify([parentId, "child"])}`;
    const parentLink = closeLayout.links.find((link) => link.relationshipKeys?.includes(key));
    assert.ok(parentLink, "the circular view must draw both recorded parents of the shared child");
    assert.match(parentLink.d, / Q /, "parent connections follow circular geometry");
  }
  assert.ok(closeLayout.links.some((link) => link.relationshipKeys?.includes(`parent:${JSON.stringify([result.person.id, "other-child"])}`)));
  assert.ok(result.family.relationships.some((r) => r.type === "parent" && r.fromPersonId === result.person.id && r.toPersonId === "other-child" && r.origin === "spouse"));
});

test("an unchecked spouse form infers parenthood for existing children", () => {
  for (const sharedChildIds of [undefined, []]) {
    const family = fixture();
    const result = addPersonToFamily(family, { ...input, sharedChildIds });
    assert.equal(result.family.relationships.length, family.relationships.length + 3);
    assert.equal(result.family.relationships.filter((r) => r.type === "parent" && r.fromPersonId === result.person.id).length, 2);
  }
});

test("checked children are trimmed and deduplicated while unselected children are inferred", () => {
  const result = addPersonToFamily(fixture(), { ...input, sharedChildIds: [" child ", "child"] });
  assert.deepEqual(result.family.relationships.filter((r) => r.type === "parent" && r.fromPersonId === result.person.id).map((r) => r.toPersonId), ["child", "other-child"]);
});

test("shared-child candidates exclude archived children and count distinct parents including archived ones", () => {
  const family = fixture();
  family.relationships.push({ type: "parent", fromPersonId: "father", toPersonId: "child" });
  assert.deepEqual(getSharedChildrenCandidates(family, "father").map((p) => p.id), ["child", "other-child"]);
  family.people.find((p) => p.id === "other-child")!.isArchived = true;
  family.relationships.push({ type: "parent", fromPersonId: "archived-parent", toPersonId: "child" });
  assert.deepEqual(getSharedChildrenCandidates(family, "father"), []);
});

test("forged, unrelated, archived and already fully linked children reject the whole creation", () => {
  for (const id of ["missing", "unrelated", "father", "archived", "full"]) {
    const family = fixture();
    family.people.push({ ...family.people[0], id: "full" }, { ...family.people[0], id: "archived", isArchived: true });
    family.relationships.push(
      { type: "parent", fromPersonId: "father", toPersonId: "full" },
      { type: "parent", fromPersonId: "other-parent", toPersonId: "full" },
      { type: "parent", fromPersonId: "father", toPersonId: "archived" },
    );
    const before = structuredClone(family);
    assert.throws(() => addPersonToFamily(family, { ...input, sharedChildIds: ["child", id] }), /существующих детей/);
    assert.deepEqual(family, before);
  }
});

test("shared children are rejected for unrelated creation modes and an empty family", () => {
  for (const relationshipKind of ["parent", "child", "sibling"] as const) {
    assert.throws(() => addPersonToFamily(fixture(), { ...input, relationshipKind, sharedChildIds: ["child"] }), /только при добавлении супруга/);
  }
  const emptyFamily = { ...fixture(), people: [], relationships: [] };
  const before = structuredClone(emptyFamily);
  // With no relative selected, the shared-child guard remains the rejection.
  assert.throws(() => addPersonToFamily(emptyFamily, { ...input, relativePersonId: "", sharedChildIds: ["child"] }), /только при добавлении супруга/);
  // A forged relative in an empty family is now rejected even earlier.
  assert.throws(() => addPersonToFamily(emptyFamily, { ...input, sharedChildIds: ["child"] }), /Первый человек.*без родственника/);
  assert.deepEqual(emptyFamily, before);
});

test("registration of a second parent relative to the child still directly records motherhood", () => {
  const result = addPersonToFamily(fixture(), { ...input, relationshipKind: "parent", relativePersonId: "child" });
  assert.ok(result.family.relationships.some((r) => r.type === "parent" && r.fromPersonId === result.person.id && r.toPersonId === "child"));
  assert.ok(!result.family.relationships.some((r) => r.type === "spouse"));
});

test("creation parser validates the shared-child payload and preserves old requests", () => {
  assert.equal(Object.hasOwn(parseAddPersonInput(input), "sharedChildIds"), false);
  assert.deepEqual(parseAddPersonInput({ ...input, sharedChildIds: [" child ", "child"] }).sharedChildIds, ["child"]);
  for (const sharedChildIds of [null, "child", {}, [null], [1], [""], ["   "], ["x".repeat(121)], Array(101).fill("child")]) {
    assert.throws(() => parseAddPersonInput({ ...input, sharedChildIds }));
  }
  assert.throws(() => parseAddPersonInput({ ...input, relationshipKind: "child", sharedChildIds: ["child"] }), /только при добавлении супруга/);
  assert.throws(() => parseAddPersonInput([]), /Некорректный payload/);
});
