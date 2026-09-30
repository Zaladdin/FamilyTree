import test from "node:test";
import assert from "node:assert/strict";
import { addRelationshipToFamily, parseAddExistingRelationshipInput, type RelationshipFamily } from "@/lib/family-relationships";
import { HttpError } from "@/lib/http-error";
import type { FamilyRelationship } from "@/lib/types";

function graph(relationships: FamilyRelationship[] = []): RelationshipFamily & { title: string } {
  return {
    title: "Семья",
    people: ["mom", "dad", "child", "other", "grandparent"].map((id) => ({ id, isArchived: false })),
    relationships,
  };
}
const parent = (fromPersonId: string, toPersonId: string): FamilyRelationship => ({ fromPersonId, toPersonId, type: "parent" });
const spouse = (fromPersonId: string, toPersonId: string): FamilyRelationship => ({ fromPersonId, toPersonId, type: "spouse" });
const rejected = (run: () => unknown, text: RegExp, status = 400) => assert.throws(run, (error: unknown) => error instanceof HttpError && error.status === status && text.test(error.message));

test("an explicit mother-to-child edge does not infer children from marriage", () => {
  const initial = graph([parent("dad", "child"), spouse("dad", "mom")]);
  const before = structuredClone(initial);
  const result = addRelationshipToFamily(initial, "mom", { relativePersonId: "child", relationshipKind: "parent" });
  assert.equal(result.created, true);
  assert.deepEqual(result.relationship, parent("mom", "child"));
  assert.deepEqual(result.family.relationships, [...initial.relationships, parent("mom", "child")]);
  assert.equal(result.family.title, "Семья");
  assert.deepEqual(initial, before);
});

test("child role reverses edge direction and spouse role creates only one explicit edge", () => {
  const child = addRelationshipToFamily(graph(), "child", { relativePersonId: "mom", relationshipKind: "child" });
  assert.deepEqual(child.relationship, parent("mom", "child"));
  const married = addRelationshipToFamily(graph([parent("dad", "child")]), "mom", { relativePersonId: "dad", relationshipKind: "spouse" });
  assert.deepEqual(married.family.relationships, [parent("dad", "child"), spouse("mom", "dad")]);
});

test("existing parent edge is idempotent for either perspective", () => {
  const initial = graph([parent("mom", "child")]);
  for (const [personId, relativePersonId, relationshipKind] of [
    ["mom", "child", "parent"], ["child", "mom", "child"],
  ] as const) {
    const result = addRelationshipToFamily(initial, personId, { relativePersonId, relationshipKind });
    assert.equal(result.created, false);
    assert.equal(result.family, initial);
  }
});

test("inverse spouse edge is idempotent", () => {
  const initial = graph([spouse("dad", "mom")]);
  const result = addRelationshipToFamily(initial, "mom", { relativePersonId: "dad", relationshipKind: "spouse" });
  assert.equal(result.created, false);
  assert.equal(result.family, initial);
});

test("self relationships are rejected for every role", () => {
  for (const relationshipKind of ["parent", "child", "spouse", "sibling"] as const) {
    rejected(() => addRelationshipToFamily(graph(), "mom", { relativePersonId: "mom", relationshipKind }), /самим собой/);
  }
});

test("both subject and relative must be active people in the supplied family", () => {
  const initial = graph();
  initial.people.find((person) => person.id === "mom")!.isArchived = true;
  for (const [personId, relativePersonId] of [["mom", "child"], ["child", "mom"], ["other-family", "child"], ["child", "other-family"]]) {
    rejected(() => addRelationshipToFamily(initial, personId, { relativePersonId, relationshipKind: "parent" }), /Оба человека/, 404);
  }
});

test("parent and spouse are incompatible regardless of edge orientation", () => {
  for (const existing of [parent("mom", "child"), parent("child", "mom")]) {
    rejected(() => addRelationshipToFamily(graph([existing]), "mom", { relativePersonId: "child", relationshipKind: "spouse" }), /несовместимая/);
  }
  for (const existing of [spouse("mom", "child"), spouse("child", "mom")]) {
    for (const relationshipKind of ["parent", "child"] as const) {
      rejected(() => addRelationshipToFamily(graph([existing]), "mom", { relativePersonId: "child", relationshipKind }), /несовместимая/);
    }
  }
});

test("direct and multi-generation ancestry cycles are rejected", () => {
  rejected(() => addRelationshipToFamily(graph([parent("mom", "child")]), "child", { relativePersonId: "mom", relationshipKind: "parent" }), /цикл/);
  const initial = graph([parent("grandparent", "mom"), parent("mom", "child")]);
  rejected(() => addRelationshipToFamily(initial, "grandparent", { relativePersonId: "child", relationshipKind: "child" }), /цикл/);
});

test("ancestry traversal terminates even when unrelated old data already contains a cycle", () => {
  const initial = graph([parent("mom", "dad"), parent("dad", "mom")]);
  assert.equal(addRelationshipToFamily(initial, "other", { relativePersonId: "mom", relationshipKind: "parent" }).created, true);
});

test("a third distinct recorded parent is rejected, including archived parents", () => {
  const initial = graph([parent("mom", "child"), parent("dad", "child")]);
  initial.people.find((person) => person.id === "dad")!.isArchived = true;
  rejected(() => addRelationshipToFamily(initial, "other", { relativePersonId: "child", relationshipKind: "parent" }), /два родителя/);
  rejected(() => addRelationshipToFamily(initial, "child", { relativePersonId: "other", relationshipKind: "child" }), /два родителя/);
});

test("parent limit counts distinct people, while repeating either existing parent remains harmless", () => {
  const initial = graph([parent("dad", "child"), parent("dad", "child")]);
  const second = addRelationshipToFamily(initial, "mom", { relativePersonId: "child", relationshipKind: "parent" });
  assert.equal(second.created, true);
  assert.equal(addRelationshipToFamily(second.family, "mom", { relativePersonId: "child", relationshipKind: "parent" }).created, false);
});

test("relationship payload requires an object, a supported role and a bounded nonempty identifier", () => {
  for (const input of [null, undefined, [], ["child"], "child", 42, {}, { relativePersonId: "child", relationshipKind: "unknown" }, { relativePersonId: "child", relationshipKind: ["parent"] }, { relativePersonId: " ", relationshipKind: "parent" }, { relativePersonId: 123, relationshipKind: "parent" }, { relativePersonId: "x".repeat(121), relationshipKind: "parent" }]) {
    assert.throws(() => parseAddExistingRelationshipInput(input), HttpError);
  }
  assert.deepEqual(parseAddExistingRelationshipInput({ relativePersonId: " child ", relationshipKind: "parent" }), { relativePersonId: "child", relationshipKind: "parent" });
});
