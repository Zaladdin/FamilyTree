import test from "node:test";
import assert from "node:assert/strict";
import { parseAddPersonInput, parseCreateStoryInput, parseUpdatePersonInput, parseStoryVersionInput, parseUpdateStoryInput } from "@/lib/request-validation";
import { addPersonToFamily } from "@/lib/family-logic";
import type { Family } from "@/lib/types";

const person = { firstName: " Анна  Мария ", lastName: "Тестовая", gender: "female", birthDate: "1980", birthPlace: "Баку", relationshipKind: "child" };
const prose = "  Первый абзац.\r\n\r\nВторой  абзац.\rТретья строка.  ";
const preserved = "Первый абзац.\n\nВторой  абзац.\nТретья строка.";

test("story body preserves paragraphs and inner spaces while titles stay single-line", () => {
  assert.deepEqual(parseCreateStoryInput({ title: " Первая\n история ", narrator: " Анна\t Мария ", body: prose }), {
    title: "Первая история", narrator: "Анна Мария", body: preserved,
  });
});

test("person creation and edit preserve biography and note paragraphs", () => {
  const created = parseAddPersonInput({ ...person, biography: prose });
  assert.equal(created.biography, preserved);
  assert.equal(created.firstName, "Анна Мария");
  const edited = parseUpdatePersonInput({ ...person, expectedVersion: 0, status: "living", biography: prose, note: prose });
  assert.equal(edited.biography, preserved);
  assert.equal(edited.note, preserved);
});

test("pure person planner does not flatten biography after request validation", () => {
  const family = { people: [], archivedPeople: [], relationships: [], stats: { people: 0 } } as unknown as Family;
  const result = addPersonToFamily(family, parseAddPersonInput({ ...person, biography: prose }));
  assert.equal(result.person.biography, preserved);
});

test("multiline limits remain enforced and whitespace-only stories are rejected", () => {
  assert.throws(() => parseCreateStoryInput({ title: "История", body: " \r\n\t " }), /обязательно/);
  assert.throws(() => parseCreateStoryInput({ title: "История", body: "я".repeat(12001) }), /слишком длинное/);
  assert.throws(() => parseAddPersonInput({ ...person, biography: "я".repeat(6001) }), /слишком длинное/);
  assert.throws(() => parseUpdatePersonInput({ ...person, expectedVersion: 0, status: "living", note: "я".repeat(4001) }), /слишком длинное/);
  assert.equal(parseCreateStoryInput({ title: "История", body: "я".repeat(12000) }).body.length, 12000);
});

test("HTML-shaped plain text is preserved as content, not interpreted by normalization", () => {
  const body = '<script>alert("test")</script>\n\n<b>История</b>';
  assert.equal(parseCreateStoryInput({ title: "История", body }).body, body);
});

test("story mutations require a safe explicit version without flattening edited paragraphs", () => {
  for (const version of [undefined, null, -1, 1.5, "0", Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseStoryVersionInput({ expectedVersion: version }), /версию истории/);
  }
  assert.deepEqual(parseUpdateStoryInput({ title: "История", body: prose, expectedVersion: 0 }), {
    title: "История", body: preserved, narrator: "", expectedVersion: 0,
  });
});
