import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdditionalRelationshipsFields, AutomaticParenthoodNotice, ExistingRelationshipFields } from "@/components/family-relationship-fields";
import { getFamilyBySlug } from "@/lib/mock-data";
import type { FamilyPerson } from "@/lib/types";

function fixturePeople() {
  const family = getFamilyBySlug("akhmedov");
  assert.ok(family);
  const template = family.people[0];
  const mother: FamilyPerson = { ...template, id: "mother", firstName: "Мария", lastName: "Тестовая", gender: "female", isArchived: false };
  const child: FamilyPerson = { ...template, id: "child", firstName: "Михаил", lastName: "Тестовый", gender: "male", isArchived: false };
  const archived: FamilyPerson = { ...template, id: "archived", firstName: "Архивный", isArchived: true };
  return { mother, child, archived };
}

test("existing relationship preview states the selected mother and child without creating a duplicate", () => {
  const { mother, child, archived } = fixturePeople();
  const markup = renderToStaticMarkup(createElement(ExistingRelationshipFields, {
    subject: mother, people: [mother, child, archived], relativePersonId: child.id, relationshipKind: "parent",
    onRelativeChange: () => {}, onKindChange: () => {},
  }));
  assert.match(markup, /Мать: Мария Тестовая\. Ребёнок: Михаил Тестовый\./);
  assert.match(markup, /Новая карточка не создаётся/);
  assert.match(markup, /<option value="parent" selected="">Мать<\/option>/);
  assert.match(markup, /<option value="child">Дочь<\/option>/);
  assert.match(markup, /<option value="spouse">Жена<\/option>/);
  assert.ok(!markup.includes('<option value="mother"'));
  assert.ok(!markup.includes('<option value="archived"'));
  assert.match(markup, /<option value="child" selected="">Михаил Тестовый/);
});

test("child role reverses parent direction and uses male subject labels", () => {
  const { mother, child } = fixturePeople();
  const markup = renderToStaticMarkup(createElement(ExistingRelationshipFields, {
    subject: child, people: [mother, child], relativePersonId: mother.id, relationshipKind: "child",
    onRelativeChange: () => {}, onKindChange: () => {},
  }));
  assert.match(markup, /Мать: Мария Тестовая\. Ребёнок: Михаил Тестовый\./);
  assert.match(markup, /<option value="parent">Отец<\/option>/);
  assert.match(markup, /<option value="child" selected="">Сын<\/option>/);
  assert.match(markup, /<option value="spouse">Муж<\/option>/);
});

test("spouse preview describes automatic parenthood and user correction", () => {
  const { mother, child } = fixturePeople();
  const markup = renderToStaticMarkup(createElement(ExistingRelationshipFields, {
    subject: mother, people: [mother, child], relativePersonId: child.id, relationshipKind: "spouse",
    onRelativeChange: () => {}, onKindChange: () => {}, disabled: true,
  }));
  assert.match(markup, /Супруги: Мария Тестовая и Михаил Тестовый/);
  assert.match(markup, /родительские связи добавятся автоматически/);
  assert.match(markup, /исправить или удалить/);
  assert.equal((markup.match(/<select\b[^>]*disabled=""/g) ?? []).length, 2);
});

test("a lone selected person cannot be linked to themselves or an archived person", () => {
  const { mother, archived } = fixturePeople();
  const markup = renderToStaticMarkup(createElement(ExistingRelationshipFields, {
    subject: mother, people: [mother, archived], relativePersonId: "", relationshipKind: "parent",
    onRelativeChange: () => {}, onKindChange: () => {},
  }));
  assert.match(markup, /Сначала добавьте в дерево ещё одного человека/);
  assert.match(markup, /<select\b[^>]*required="" disabled=""/);
  assert.ok(!markup.includes('role="status"'));
});

test("spouse notice describes the default without opt-in child checkboxes", () => {
  const markup = renderToStaticMarkup(createElement(AutomaticParenthoodNotice, { relationshipKind: "spouse" }));
  assert.match(markup, /родительские связи добавятся автоматически/);
  assert.match(markup, /исправить или удалить/);
  assert.doesNotMatch(markup, /type="checkbox"|sharedChildIds/);
});

test("sibling notice shares recorded parents without inventing unknown people", () => {
  const markup = renderToStaticMarkup(createElement(AutomaticParenthoodNotice, { relationshipKind: "sibling" }));
  assert.match(markup, /Известные родители/);
  assert.match(markup, /неизвестные родители не создаются/);
  assert.match(markup, /исправить или удалить/);
});

test("existing sibling relationship is explicitly labelled and never previewed as parenthood", () => {
  const { mother, child } = fixturePeople();
  const markup = renderToStaticMarkup(createElement(ExistingRelationshipFields, {
    subject: mother, people: [mother, child], relativePersonId: child.id, relationshipKind: "sibling",
    onRelativeChange: () => {}, onKindChange: () => {},
  }));
  assert.match(markup, /<option value="sibling" selected="">Сестра<\/option>/);
  assert.match(markup, /Брат и сестра: Мария Тестовая и Михаил Тестовый/);
  assert.doesNotMatch(markup, /Мать: Мария/);
});

test("additional relations have distinct labels and existing or prior draft choices", () => {
  const { mother, child, archived } = fixturePeople();
  const markup = renderToStaticMarkup(createElement(AdditionalRelationshipsFields, {
    people: [mother, child, archived], earlierPeople: [{ clientId: "prior", firstName: "Папа", lastName: "Новый" }],
    relationships: [{ relationshipKind: "child", relativePersonId: "", relativeClientId: "prior" }],
    onChange: () => {}, disabled: false,
  }));
  assert.match(markup, /Связь 2/);
  assert.match(markup, /value="draft:prior" selected=""/);
  assert.match(markup, /Удалить связь 2/);
  assert.doesNotMatch(markup, /value="existing:archived"/);
  assert.match(markup, /Ещё связь/);
  const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test("additional relationships honor the ten total relation limit and busy state", () => {
  const { mother } = fixturePeople();
  const markup = renderToStaticMarkup(createElement(AdditionalRelationshipsFields, {
    people: [mother], relationships: Array.from({ length: 9 }, () => ({ relationshipKind: "child" as const, relativePersonId: mother.id })),
    onChange: () => {}, disabled: true,
  }));
  assert.equal((markup.match(/<select\b[^>]*disabled=""/g) ?? []).length, 18);
  assert.match(markup, /<button[^>]*disabled=""[^>]*>\+ Ещё связь/);
});
