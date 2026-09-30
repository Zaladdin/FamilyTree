import test from "node:test";
import assert from "node:assert/strict";
import { applyAutomaticParenthood, formatParentInferenceWarnings } from "@/lib/family-parent-inference";
import { addPersonToFamily, type AddPersonInput } from "@/lib/family-logic";
import { addPeopleToFamily } from "@/lib/family-batch";
import { getFamilyBySlug } from "@/lib/mock-data";
import type { Family, FamilyRelationship } from "@/lib/types";

const edge = (type: FamilyRelationship["type"], fromPersonId: string, toPersonId: string): FamilyRelationship => ({ type, fromPersonId, toPersonId });
function family(ids: string[], relationships: FamilyRelationship[]): Family {
  const sample = structuredClone(getFamilyBySlug("akhmedov")!);
  return { ...sample, people: ids.map((id) => ({ ...sample.people[0], id, firstName: id })), archivedPeople: [], relationships };
}
const parents = (data: Family, id: string) => data.relationships.filter((r) => r.type === "parent" && r.toPersonId === id).map((r) => r.fromPersonId).sort();
const input: AddPersonInput = { firstName: "Новый", lastName: "Человек", birthDate: "2000", birthPlace: "Баку", gender: "male", relationshipKind: "child", relativePersonId: "p" };

test("a spouse seed copies children both ways regardless of its orientation and records provenance", () => {
  for (const spouse of [edge("spouse", "p", "q"), edge("spouse", "q", "p")]) {
    const data = family(["p", "q", "a", "b"], [edge("parent", "p", "a"), edge("parent", "q", "b"), spouse]);
    const before = structuredClone(data);
    const result = applyAutomaticParenthood(data, [spouse]);
    assert.deepEqual(parents(result.family, "a"), ["p", "q"]);
    assert.deepEqual(parents(result.family, "b"), ["p", "q"]);
    assert.deepEqual(result.family.relationships.find((r) => r.fromPersonId === "q" && r.toPersonId === "a"), { ...edge("parent", "q", "a"), origin: "spouse", sourcePersonId: "p" });
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(data, before);
    assert.deepEqual(applyAutomaticParenthood(result.family, [spouse]).family, result.family);
  }
});

test("siblings share known parents in both directions without inventing unknown people", () => {
  for (const sibling of [edge("sibling", "a", "b"), edge("sibling", "b", "a")]) {
    const data = family(["p", "q", "a", "b"], [edge("parent", "p", "a"), edge("parent", "q", "b"), sibling]);
    const result = applyAutomaticParenthood(data, [sibling]);
    assert.deepEqual(parents(result.family, "a"), ["p", "q"]);
    assert.deepEqual(parents(result.family, "b"), ["p", "q"]);
    assert.deepEqual(result.family.relationships.find((r) => r.fromPersonId === "p" && r.toPersonId === "b"), { ...edge("parent", "p", "b"), origin: "sibling", sourcePersonId: "a" });
    const unknown = family(["a", "b"], [sibling]);
    assert.deepEqual(applyAutomaticParenthood(unknown, [sibling]), { family: unknown, warnings: [] });
  }
});

test("a later parent reaches recorded siblings and the unique spouse through a bounded cascade", () => {
  const parent = edge("parent", "p", "a");
  const data = family(["p", "q", "a", "b", "c"], [edge("spouse", "p", "q"), edge("sibling", "a", "b"), edge("sibling", "b", "c"), parent]);
  const result = applyAutomaticParenthood(data, [parent]);
  for (const id of ["a", "b", "c"]) assert.deepEqual(parents(result.family, id), ["p", "q"]);
  assert.equal(result.family.people.length, 5);
  assert.equal(result.family.relationships.length, 9);
  assert.deepEqual(result.warnings, []);
});

test("saved suppressions survive repeated inference and both spouse and sibling paths", () => {
  const spouse = edge("spouse", "p", "q");
  const sibling = edge("sibling", "a", "b");
  const data = { ...family(["p", "q", "a", "b"], [spouse, sibling, edge("parent", "p", "a"), edge("parent", "q", "b")]), parentSuppressions: [{ fromPersonId: "q", toPersonId: "a" }] };
  const result = applyAutomaticParenthood(data, [spouse, sibling]);
  assert.deepEqual(parents(result.family, "a"), ["p"]);
  assert.deepEqual(parents(result.family, "b"), ["p", "q"]);
  assert.deepEqual(applyAutomaticParenthood(result.family, [spouse, sibling]).family, result.family);
  assert.deepEqual(result.family.parentSuppressions, data.parentSuppressions);
});

test("multiple marriages keep the explicit edge and report ambiguity instead of choosing a spouse", () => {
  const parent = edge("parent", "p", "a");
  const data = family(["p", "q", "r", "a"], [edge("spouse", "p", "q"), edge("spouse", "r", "p"), parent]);
  const result = applyAutomaticParenthood(data, [parent]);
  assert.deepEqual(parents(result.family, "a"), ["p"]);
  assert.deepEqual(result.warnings.map((w) => [w.parentId, w.childId]).sort(), [["q", "a"], ["r", "a"]]);
  assert.ok(result.warnings.every((w) => /несколько супругов/.test(w.message)));
});

test("an archived spouse still prevents arbitrary selection of another spouse", () => {
  const parent = edge("parent", "p", "a");
  const data = family(["p", "q", "archived", "a"], [edge("spouse", "p", "q"), edge("spouse", "p", "archived"), parent]);
  data.people.find((person) => person.id === "archived")!.isArchived = true;
  const result = applyAutomaticParenthood(data, [parent]);
  assert.deepEqual(result.family, data);
  assert.ok(result.warnings.some((warning) => warning.parentId === "q" && /несколько супругов/.test(warning.message)));
});

test("competing parent candidates do not arbitrarily fill the last slot", () => {
  const seeds = [edge("sibling", "a", "b"), edge("sibling", "a", "c")];
  const data = family(["p", "q", "r", "a", "b", "c"], [edge("parent", "p", "a"), edge("parent", "q", "b"), edge("parent", "r", "c"), ...seeds]);
  for (const orderedSeeds of [seeds, [...seeds].reverse()]) {
    const result = applyAutomaticParenthood(data, orderedSeeds);
    assert.deepEqual(parents(result.family, "a"), ["p"]);
    assert.ok(result.warnings.some((w) => w.childId === "a" && /неоднознач/.test(w.message)));
  }
});

test("an ambiguous parent choice stays blocked when another cascade proposes one candidate again", () => {
  const seeds = [edge("sibling", "a", "b"), edge("sibling", "a", "c"), edge("sibling", "b", "d")];
  const data = family(["p", "q", "r", "a", "b", "c", "d"], [
    edge("parent", "p", "a"), edge("parent", "q", "b"), edge("parent", "r", "c"), edge("sibling", "d", "a"), ...seeds,
  ]);
  const result = applyAutomaticParenthood(data, seeds);
  assert.deepEqual(parents(result.family, "a"), ["p"]);
  assert.ok(parents(result.family, "d").includes("q"), "the independent branch still receives its known parent");
});

test("different sibling path lengths cannot choose between competing parents in one operation", () => {
  const seeds = [edge("parent", "q", "b"), edge("parent", "r", "c")];
  const data = family(["p", "q", "r", "a", "b", "c", "d", "e"], [
    edge("parent", "p", "a"), edge("sibling", "b", "d"), edge("sibling", "d", "a"),
    edge("sibling", "c", "a"), edge("sibling", "a", "e"), ...seeds,
  ]);
  for (const orderedSeeds of [seeds, [...seeds].reverse()]) {
    const result = applyAutomaticParenthood(data, orderedSeeds);
    assert.deepEqual(parents(result.family, "a"), ["p"]);
    assert.deepEqual(parents(result.family, "e"), [], "consequences of rejected parent candidates must be rolled back");
    assert.ok(result.warnings.filter((warning) => warning.childId === "a").every((warning) => /неоднознач/.test(warning.message)));
  }
});

test("jointly cyclic automatic candidates do not pick a winner by child ID", () => {
  const seeds = [edge("spouse", "p", "a"), edge("spouse", "q", "b")];
  const data = family(["p", "q", "a", "b"], [edge("parent", "p", "b"), edge("parent", "q", "a"), ...seeds]);
  const result = applyAutomaticParenthood(data, seeds);
  assert.deepEqual(result.family, data);
  assert.ok(result.warnings.some((warning) => /несовместим/.test(warning.message)));
});

test("joint sibling ancestry conflicts roll back only conflicting automatic branches", () => {
  const seeds = [edge("spouse", "x", "a"), edge("spouse", "y", "c"), edge("parent", "p", "z")];
  const data = family(["a", "b", "c", "x", "y", "p", "q", "z"], [
    edge("sibling", "a", "b"), edge("parent", "x", "c"), edge("parent", "y", "b"), edge("spouse", "p", "q"), ...seeds,
  ]);
  const result = applyAutomaticParenthood(data, seeds);
  assert.deepEqual(parents(result.family, "b"), ["y"]);
  assert.deepEqual(parents(result.family, "c"), ["x"]);
  assert.deepEqual(parents(result.family, "z"), ["p", "q"]);
  assert.ok(result.warnings.some((warning) => /несовместим/.test(warning.message)));
});

test("two explicit parents take precedence and a blocked automatic edge becomes a warning", () => {
  const data = family(["p", "q", "r"], [edge("spouse", "p", "q")]);
  const result = addPersonToFamily(data, { ...input, additionalRelationships: [{ relationshipKind: "child", relativePersonId: "r" }] });
  assert.deepEqual(parents(result.family, result.person.id), ["p", "r"]);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0].message, /два родителя/);
});

test("cycles through archived people and incompatible pair roles reject only automatic candidates", () => {
  const spouse = edge("spouse", "p", "q");
  const data = family(["p", "q", "a", "archived"], [edge("parent", "p", "a"), edge("parent", "a", "archived"), edge("parent", "archived", "q"), spouse]);
  data.people.find((p) => p.id === "archived")!.isArchived = true;
  const result = applyAutomaticParenthood(data, [spouse]);
  assert.deepEqual(result.family, data);
  assert.ok(result.warnings.some((w) => w.parentId === "q" && w.childId === "a" && /цикл/.test(w.message)));
  const incompatible = family(["p", "q", "a"], [edge("parent", "p", "a"), edge("spouse", "q", "a"), spouse]);
  const other = applyAutomaticParenthood(incompatible, [spouse]);
  assert.deepEqual(parents(other.family, "a"), ["p"]);
  assert.ok(other.warnings.some((w) => /несовместим/.test(w.message)));
});

test("archived parents still consume slots and archived endpoints never gain automatic edges", () => {
  const spouse = edge("spouse", "p", "q");
  const data = family(["p", "q", "a", "archived"], [spouse, edge("parent", "p", "a"), edge("parent", "archived", "a"), edge("parent", "p", "archived")]);
  data.people.find((p) => p.id === "archived")!.isArchived = true;
  const result = applyAutomaticParenthood(data, [spouse]);
  assert.deepEqual(result.family, data);
  assert.ok(result.warnings.some((w) => /два родителя/.test(w.message)));
});

test("inference touches only seeded changes and does not backfill another existing branch", () => {
  const seed = edge("parent", "p", "a");
  const data = family(["p", "a", "x", "y", "z"], [seed, edge("spouse", "x", "y"), edge("parent", "x", "z")]);
  assert.deepEqual(applyAutomaticParenthood(data, [seed]).family, data);
  assert.deepEqual(applyAutomaticParenthood(data, []).family, data);
  assert.deepEqual(applyAutomaticParenthood(data, [edge("parent", "x", "a")]).family, data);
});

test("warning formatting uses readable people names and never exposes missing internal IDs", () => {
  assert.deepEqual(formatParentInferenceWarnings([
    { parentId: "p", childId: "a", message: "Уже указаны два родителя." },
    { parentId: "missing-id", childId: "other-missing", message: "Связь невозможна." },
  ], [
    { id: "p", firstName: "Али", middleName: "Рашидович", lastName: "Исаев" },
    { id: "a", firstName: "Лейла", lastName: "Исаева" },
  ]), ["Али Рашидович Исаев → Лейла Исаева: Уже указаны два родителя.", "Родитель → Ребёнок: Связь невозможна."]);
});

test("single and batch creation infer the same parents for absent and empty optional arrays", () => {
  const data = family(["p", "q"], [edge("spouse", "p", "q")]);
  for (const additionalRelationships of [undefined, []]) {
    const one = addPersonToFamily(data, { ...input, additionalRelationships });
    const batch = addPeopleToFamily(data, [{ ...input, additionalRelationships, clientId: "new" }]);
    assert.deepEqual(parents(one.family, one.person.id), ["p", "q"]);
    assert.deepEqual(batch.family.relationships, one.family.relationships);
    assert.deepEqual(batch.warnings, one.warnings);
  }
});

test("all explicit batch edges are staged before automatic edges even when a later row supplies the second parent", () => {
  const data = family(["p", "q"], [edge("spouse", "p", "q")]);
  const result = addPeopleToFamily(data, [
    { ...input, clientId: "child" },
    { ...input, firstName: "Родитель", clientId: "parent", relationshipKind: "parent", relativePersonId: "", relativeClientId: "child" },
  ]);
  assert.deepEqual(parents(result.family, result.people[0].id), ["p", result.people[1].id].sort());
  assert.ok(result.warnings.some((w) => w.parentId === "q" && w.childId === result.people[0].id));
});
