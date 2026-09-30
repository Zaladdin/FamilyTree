import test from "node:test";
import assert from "node:assert/strict";
import { parseAddPersonInput } from "@/lib/request-validation";
import { addRelationshipToFamily } from "@/lib/family-relationships";
import type { FamilyRelationship } from "@/lib/types";

const person = {
  firstName: "Тест", lastName: "Связей", gender: "male", birthDate: "2000", birthPlace: "Баку",
  relationshipKind: "child", relativePersonId: "dad",
};
test("creation parser preserves bounded explicit relationships and rejects malformed inputs", () => {
  const parsed = parseAddPersonInput({ ...person, additionalRelationships: [{ relationshipKind: "child", relativePersonId: " mom " }] });
  assert.deepEqual(parsed.additionalRelationships, [{ relationshipKind: "child", relativePersonId: "mom" }]);
  for (const additionalRelationships of [null, {}, Array(10).fill({ relationshipKind: "child", relativePersonId: "mom" }),
    [null], [{ relationshipKind: "fake", relativePersonId: "mom" }], [{ relationshipKind: "child", relativePersonId: "" }],
    [{ relationshipKind: "child", relativePersonId: "mom", relativeClientId: "draft" }],
    [{ relationshipKind: "child", relativePersonId: "", relativeClientId: "draft" }],
  ]) assert.throws(() => parseAddPersonInput({ ...person, additionalRelationships }));
  assert.throws(() => parseAddPersonInput({ ...person, relativeClientId: "draft" }));
});

test("existing sibling links are symmetric and idempotent without any known parent", () => {
  const family = { people: ["a", "b"].map((id) => ({ id, isArchived: false })), relationships: [] };
  const first = addRelationshipToFamily(family, "a", { relationshipKind: "sibling", relativePersonId: "b" });
  assert.deepEqual(first.relationship, { type: "sibling", fromPersonId: "a", toPersonId: "b" });
  const reverse = addRelationshipToFamily(first.family, "b", { relationshipKind: "sibling", relativePersonId: "a" });
  assert.equal(reverse.created, false);
  assert.equal(reverse.family.relationships.length, 1);
});

test("sibling links reject self, archived or foreign relatives, direct incompatible roles and ancestors", () => {
  const people = ["a", "b", "c"].map((id) => ({ id, isArchived: false }));
  for (const type of ["parent", "spouse"] as const) {
    for (const [fromPersonId, toPersonId] of [["a", "b"], ["b", "a"]]) {
      assert.throws(() => addRelationshipToFamily({ people, relationships: [{ type, fromPersonId, toPersonId }] }, "a", { relationshipKind: "sibling", relativePersonId: "b" }), /несовместимая/);
    }
  }
  const relationships: FamilyRelationship[] = [
    { type: "parent", fromPersonId: "a", toPersonId: "b" },
    { type: "parent", fromPersonId: "b", toPersonId: "c" },
  ];
  assert.throws(() => addRelationshipToFamily({ people, relationships }, "a", { relationshipKind: "sibling", relativePersonId: "c" }), /Предок/);
  for (const target of ["a", "foreign"]) {
    assert.throws(() => addRelationshipToFamily({ people, relationships: [] }, "a", { relationshipKind: "sibling", relativePersonId: target }));
  }
  people[1].isArchived = true;
  assert.throws(() => addRelationshipToFamily({ people, relationships: [] }, "a", { relationshipKind: "sibling", relativePersonId: "b" }), /архиве/);
});

test("later parent links cannot make already recorded siblings ancestors regardless of insertion order", () => {
  const people = ["a", "b", "n"].map((id) => ({ id, isArchived: false }));
  const relationships: FamilyRelationship[] = [
    { type: "parent", fromPersonId: "b", toPersonId: "a" },
    { type: "sibling", fromPersonId: "n", toPersonId: "a" },
  ];
  assert.throws(() => addRelationshipToFamily({ people, relationships }, "n", { relationshipKind: "parent", relativePersonId: "b" }), /Предок/);
  const existingSiblings: FamilyRelationship[] = [
    { type: "sibling", fromPersonId: "a", toPersonId: "b" },
    { type: "parent", fromPersonId: "a", toPersonId: "n" },
  ];
  assert.throws(() => addRelationshipToFamily({ people, relationships: existingSiblings }, "n", { relationshipKind: "parent", relativePersonId: "b" }), /Предок/);
});

test("ancestry validation uses current edges when a caller reuses a mutable relationship array", () => {
  const people = ["a", "b", "c"].map((id) => ({ id, isArchived: false }));
  const relationships: FamilyRelationship[] = [{ type: "parent", fromPersonId: "a", toPersonId: "b" }];
  assert.equal(addRelationshipToFamily({ people, relationships }, "c", { relationshipKind: "parent", relativePersonId: "a" }).created, true);
  relationships.push({ type: "parent", fromPersonId: "b", toPersonId: "c" });
  assert.throws(() => addRelationshipToFamily({ people, relationships }, "c", { relationshipKind: "parent", relativePersonId: "a" }), /цикл/);
});
