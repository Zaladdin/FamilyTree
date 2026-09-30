import test from "node:test";
import assert from "node:assert/strict";
import { MAX_BATCH_PEOPLE, addPeopleToFamily, parseBatchPersonInput, type BatchPersonEntry } from "@/lib/family-batch";
import { getFamilyBySlug } from "@/lib/mock-data";
import { HttpError } from "@/lib/http-error";

const entry = (overrides: Partial<BatchPersonEntry> = {}): BatchPersonEntry => ({
  clientId: "one", firstName: "Тест", lastName: "Пакетный", middleName: "Тестович", gender: "male",
  birthDate: "2000", birthPlace: "Баку", relationshipKind: "child", relativePersonId: "timur", ...overrides,
});
function family(empty = false) {
  const result = structuredClone(getFamilyBySlug("akhmedov")!);
  if (empty) { result.people = []; result.archivedPeople = []; result.relationships = []; result.stats.people = 0; }
  return result;
}

test("batch accepts up to ten normalized entries, preserving middle name and deceased details", () => {
  assert.equal(MAX_BATCH_PEOPLE, 10);
  const people = parseBatchPersonInput({ people: Array.from({ length: 10 }, (_, index) => entry({
    clientId: `row-${index}`, firstName: `  Имя ${index}  `,
    status: "deceased", birthDate: "1950", deathDate: "2020",
  })) });
  assert.equal(people.length, 10);
  assert.equal(people[0].firstName, "Имя 0");
  assert.equal(people[0].middleName, "Тестович");
  assert.equal(people[0].deathDate, "2020");
});

test("batch validates shape, bounded identifiers, unique draft identifiers and row count", () => {
  for (const data of [null, [], {}, { people: [] }, { people: Array(11).fill(entry()) },
    { people: [entry({ clientId: "" })] }, { people: [entry({ clientId: "x".repeat(121) })] },
    { people: [entry(), entry()] }, { people: [null] }]) {
    assert.throws(() => parseBatchPersonInput(data), HttpError);
  }
});

test("batch only resolves prior draft references and rejects self, future, unknown or ambiguous references", () => {
  const second = entry({ clientId: "two", relativePersonId: "", relativeClientId: "one" });
  assert.equal(parseBatchPersonInput({ people: [entry(), second] })[1].relativeClientId, "one");
  for (const people of [
    [entry({ relativePersonId: "", relativeClientId: "one" })],
    [entry({ relativePersonId: "", relativeClientId: "two" }), second],
    [entry(), { ...second, relativeClientId: "missing" }],
    [entry(), { ...second, relativePersonId: "timur" }],
    [entry(), { ...second, relativeClientId: 42 }],
  ]) assert.throws(() => parseBatchPersonInput({ people }), HttpError);
});

test("batch reuses person validation with an actionable row number", () => {
  for (const bad of [entry({ firstName: "" }), entry({ status: "deceased", deathDate: "1990" }),
    entry({ status: "deceased", deathDate: "" }), entry({ birthDate: "not-a-date" })]) {
    assert.throws(() => parseBatchPersonInput({ people: [entry(), { ...bad, clientId: "two" }] }), /Человек 2:/);
  }
});

test("empty trees accept the first standalone person then explicit references to earlier entries", () => {
  const initial = family(true);
  const snapshot = structuredClone(initial);
  const result = addPeopleToFamily(initial, [
    entry({ clientId: "parent", relativePersonId: "", firstName: "Родитель" }),
    entry({ clientId: "child", relativePersonId: "", relativeClientId: "parent", firstName: "Ребёнок" }),
    entry({ clientId: "sibling", relativePersonId: "", relativeClientId: "child", relationshipKind: "sibling", firstName: "Сестра", gender: "female" }),
  ]);
  assert.equal(result.family.stats.people, 3);
  assert.deepEqual(result.family.relationships, [
    { type: "parent", fromPersonId: result.people[0].id, toPersonId: result.people[1].id },
    { type: "sibling", fromPersonId: result.people[2].id, toPersonId: result.people[1].id },
    { type: "parent", fromPersonId: result.people[0].id, toPersonId: result.people[2].id, origin: "sibling", sourcePersonId: result.people[1].id },
  ]);
  assert.deepEqual(initial, snapshot);
});

test("batch rejects duplicates in the same batch or current tree without changing input", () => {
  const current = family();
  const snapshot = structuredClone(current);
  assert.throws(() => addPeopleToFamily(current, [entry(), entry({ clientId: "two" })]), /Человек 2:.*уже есть/);
  const existing = current.people[0];
  assert.throws(() => addPeopleToFamily(current, [entry({ ...existing, middleName: existing.middleName })]), /Человек 1:.*уже есть/);
  assert.deepEqual(current, snapshot);
});

test("batch requires explicit links after first person and rejects foreign references", () => {
  assert.throws(() => addPeopleToFamily(family(true), [entry({ relativePersonId: "foreign" })]), /Человек 1:/);
  assert.throws(() => addPeopleToFamily(family(true), [entry({ relativePersonId: "" }), entry({ clientId: "two", firstName: "Второй", relativePersonId: "" })]), /Человек 2:/);
  assert.throws(() => addPeopleToFamily(family(), [entry({ relativePersonId: "foreign" })]), /Человек 1:/);
});

test("batch child and later sibling automatically receive parents with recorded provenance", () => {
  const result = addPeopleToFamily(family(true), [
    entry({ clientId: "parent", firstName: "Отец", relativePersonId: "" }),
    entry({ clientId: "spouse", firstName: "Супруга", relativePersonId: "", relativeClientId: "parent", relationshipKind: "spouse" }),
    entry({ clientId: "child", firstName: "Дочь", relativePersonId: "", relativeClientId: "parent", relationshipKind: "child" }),
    entry({ clientId: "sibling", firstName: "Сын", relativePersonId: "", relativeClientId: "child", relationshipKind: "sibling" }),
  ]);
  assert.deepEqual(result.family.relationships.slice(0, 3), [
    { type: "spouse", fromPersonId: result.people[0].id, toPersonId: result.people[1].id },
    { type: "parent", fromPersonId: result.people[0].id, toPersonId: result.people[2].id },
    { type: "sibling", fromPersonId: result.people[3].id, toPersonId: result.people[2].id },
  ]);
  for (const child of result.people.slice(2)) {
    assert.deepEqual(result.family.relationships.filter((r) => r.type === "parent" && r.toPersonId === child.id)
      .map((r) => r.fromPersonId).sort(), result.people.slice(0, 2).map((p) => p.id).sort());
  }
  assert.equal(result.family.relationships.length, 6);
  assert.deepEqual(result.warnings, []);
});

test("batch resolves additional links to prior drafts so a child can have both explicitly chosen parents", () => {
  const result = addPeopleToFamily(family(true), [
    entry({ clientId: "father", firstName: "Отец", relativePersonId: "" }),
    entry({ clientId: "mother", firstName: "Мать", relativePersonId: "", relativeClientId: "father", relationshipKind: "spouse" }),
    entry({ clientId: "daughter", firstName: "Дочь", relativePersonId: "", relativeClientId: "father", relationshipKind: "child", additionalRelationships: [
      { relationshipKind: "child", relativePersonId: "", relativeClientId: "mother" },
    ] }),
  ]);
  assert.deepEqual(result.family.relationships.slice(1), [
    { type: "parent", fromPersonId: result.people[0].id, toPersonId: result.people[2].id },
    { type: "parent", fromPersonId: result.people[1].id, toPersonId: result.people[2].id },
  ]);
});

test("additional draft references reject future, unknown, self and ambiguous targets with row number", () => {
  for (const link of [
    { relativeClientId: "two", relativePersonId: "" },
    { relativeClientId: "missing", relativePersonId: "" },
    { relativeClientId: "one", relativePersonId: "timur" },
  ]) assert.throws(() => parseBatchPersonInput({ people: [entry(), entry({ clientId: "two", additionalRelationships: [
    { relationshipKind: "child", ...link },
  ] })] }), /Человек 2:/);
});
