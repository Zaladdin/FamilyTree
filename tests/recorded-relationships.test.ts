import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordedRelationships, RelationshipChangeDialog } from "@/components/recorded-relationships";
import { getFamilyBySlug } from "@/lib/mock-data";
import type { Family, FamilyRelationship } from "@/lib/types";

function fixture() {
  const template = getFamilyBySlug("akhmedov")!;
  const mother = { ...template.people[0], id: "mother", firstName: "Мария", lastName: "Тестовая", gender: "female" as const, isArchived: false };
  const father = { ...mother, id: "father", firstName: "Иван", lastName: "Тестовый", gender: "male" as const };
  const child = { ...father, id: "child", firstName: "Павел", isArchived: true };
  const relationship: FamilyRelationship = { id: "edge-1", version: 2, type: "parent", fromPersonId: mother.id, toPersonId: child.id, origin: "spouse", sourcePersonId: father.id };
  const family: Family = { ...template, people: [mother, father], archivedPeople: [child], relationships: [], recordedRelationships: [relationship] };
  return { family, mother, child, relationship };
}

test("recorded links include archived endpoints and provenance without derived kinship", () => {
  const { family, mother } = fixture();
  const html = renderToStaticMarkup(createElement(RecordedRelationships, { family, subject: mother, onSuccess: () => {}, onRefresh: () => {} }));
  assert.match(html, /Мать: Мария Тестовая\. Ребёнок: Павел Тестовый/);
  assert.match(html, /Добавлено автоматически/);
  assert.match(html, /Иван Тестовый/);
  assert.match(html, /В архиве/);
  assert.match(html, /сначала восстановите/);
  assert.match(html, /Удалить связь/);
  assert.doesNotMatch(html, /тёща|невестка/);
});

test("incoming parent edges keep the original direction in the child's list", () => {
  const { family, child } = fixture();
  const html = renderToStaticMarkup(createElement(RecordedRelationships, { family, subject: child, onSuccess: () => {}, onRefresh: () => {} }));
  assert.match(html, /Мать: Мария Тестовая\. Ребёнок: Павел Тестовый/);
  assert.doesNotMatch(html, /Отец: Павел/);
});

test("a pending outer relationship request blocks opening competing edits or deletions", () => {
  const { family, mother, child, relationship } = fixture();
  const activeFamily = { ...family, people: [...family.people, { ...child, isArchived: false }], archivedPeople: [], recordedRelationships: [relationship] };
  const html = renderToStaticMarkup(createElement(RecordedRelationships, { family: activeFamily, subject: mother, disabled: true, onSuccess: () => {}, onRefresh: () => {} }));
  const buttons = html.match(/<button\b[^>]*>/g) ?? [];
  assert.equal(buttons.length, 2);
  assert.ok(buttons.every((button) => /\sdisabled=""/.test(button)));
});

test("delete confirmation names the exact link, preserves people and explains suppression", () => {
  const { family, mother, relationship } = fixture();
  const html = renderToStaticMarkup(createElement(RelationshipChangeDialog, { family, subject: mother, relationship, mode: "delete", onClose: () => {}, onSuccess: () => {}, onRefresh: () => {} }));
  assert.match(html, /<dialog/);
  assert.match(html, /Удалить связь/);
  assert.match(html, /Мать: Мария Тестовая\. Ребёнок: Павел Тестовый/);
  assert.match(html, /Карточки людей сохранятся/);
  assert.match(html, /не появится снова автоматически/);
  assert.match(html, /добавьте её вручную/);
  assert.match(html, /aria-label="Закрыть изменение связи"/);
});

test("edit starts with incoming role, preserves expected version snapshot and shows before preview", () => {
  const { family, mother, child, relationship } = fixture();
  const activeChild = { ...child, isArchived: false };
  const html = renderToStaticMarkup(createElement(RelationshipChangeDialog, { family: { ...family, people: [mother, activeChild], archivedPeople: [] }, subject: activeChild, relationship, mode: "edit", onClose: () => {}, onSuccess: () => {}, onRefresh: () => {} }));
  assert.match(html, /value="child" selected=""/);
  assert.match(html, /value="mother" selected=""/);
  assert.match(html, /Сейчас записано/);
  assert.match(html, /Сохранить изменения/);
});
