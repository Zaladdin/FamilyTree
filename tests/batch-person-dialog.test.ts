import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BatchPersonDialog, createBatchPersonDraft, removeBatchPersonDraft } from "@/components/batch-person-dialog";
import { getFamilyBySlug } from "@/lib/mock-data";

const demoFamily = getFamilyBySlug("akhmedov")!;

function markup(busy = false) {
  return renderToStaticMarkup(createElement(BatchPersonDialog, {
    family: demoFamily,
    focusPersonId: demoFamily.people[0].id,
    busy,
    errorMessage: "",
    onClose: () => {},
    onSubmit: async () => {},
  }));
}

test("batch dialog starts with two independently labelled cards inside one modal and one form", () => {
  const html = markup();
  assert.equal((html.match(/<dialog\b/g) ?? []).length, 1);
  assert.equal((html.match(/<form\b/g) ?? []).length, 1);
  assert.ok(html.includes("Человек 1"));
  assert.ok(html.includes("Человек 2"));
  assert.equal((html.match(/<legend\b/g) ?? []).length, 2);
  assert.equal((html.match(/>Отчество<\/span>/g) ?? []).length, 2);
  assert.equal((html.match(/>Человек умер<\/span>/g) ?? []).length, 2);
  assert.ok(html.includes("Добавить всех (2)"));
  assert.ok(html.includes("Ещё человек"));
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test("batch busy state prevents card edits and modal close without dropping field values", () => {
  const html = renderToStaticMarkup(createElement(BatchPersonDialog, {
    family: demoFamily, focusPersonId: null, busy: true, errorMessage: "Ошибка соединения",
    initialPerson: { ...createBatchPersonDraft("ignored", ""), firstName: "Анна", middleName: "Ивановна", status: "deceased", deathDate: "2020", biography: "Сохранённая биография" },
    onClose: () => {}, onSubmit: async () => {},
  }));
  assert.match(html, /<fieldset[^>]*disabled=""/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /role="alert"[^>]*>Ошибка соединения/);
  assert.match(html, /value="Анна"/);
  assert.match(html, /value="Ивановна"/);
  assert.match(html, /value="2020"/);
  assert.ok(html.includes("Сохранённая биография</textarea>"));
  assert.ok(html.includes("Сохраняем…"));
});

test("first empty-family card is standalone and second can link only to preceding draft", () => {
  const html = renderToStaticMarkup(createElement(BatchPersonDialog, {
    family: { ...demoFamily, people: [], archivedPeople: [], relationships: [] },
    focusPersonId: null, busy: false, errorMessage: "", onClose: () => {}, onSubmit: async () => {},
  }));
  assert.ok(html.includes("С этого человека начнётся дерево."));
  assert.equal((html.match(/>С кем связать<\/span>/g) ?? []).length, 1);
  assert.match(html, />Человек 1 — новая карточка<\/option>/);
  assert.doesNotMatch(html, />Человек 2 — новая карточка<\/option>/);
});

test("removing a draft clears only its dependent relationship without rebinding stable IDs", () => {
  const first = createBatchPersonDraft("first", "existing");
  const second = { ...createBatchPersonDraft("second", ""), relativeClientId: "first" };
  const third = { ...createBatchPersonDraft("third", ""), relativeClientId: "second" };
  const fourth = createBatchPersonDraft("fourth", "existing");
  const original = [first, second, third, fourth];
  const result = removeBatchPersonDraft(original, "second");
  assert.deepEqual(result.map((person) => person.clientId), ["first", "third", "fourth"]);
  assert.equal(result[1].relativeClientId, undefined);
  assert.equal(result[1].relativePersonId, "");
  assert.equal(result[2].relativePersonId, "existing");
  assert.equal(third.relativeClientId, "second", "draft update must be immutable");
});

test("new batch cards keep additional relation rows and explain automatic parenthood", () => {
  assert.deepEqual(createBatchPersonDraft("child", "father").additionalRelationships, []);
  assert.equal((markup().match(/Ещё связь/g) ?? []).length, 2);
  assert.match(markup(), /дополняют родителей автоматически/);
  assert.doesNotMatch(markup(), /sharedChildIds/);
});

test("removing a batch card clears references in every additional relationship", () => {
  const first = createBatchPersonDraft("first", "existing");
  const second = { ...createBatchPersonDraft("second", "existing"), additionalRelationships: [
    { relationshipKind: "child" as const, relativePersonId: "", relativeClientId: "first" },
    { relationshipKind: "sibling" as const, relativePersonId: "existing-sister" },
  ] };
  const result = removeBatchPersonDraft([first, second], "first");
  assert.deepEqual(result[0].additionalRelationships, [
    { relationshipKind: "child", relativePersonId: "", relativeClientId: undefined },
    { relationshipKind: "sibling", relativePersonId: "existing-sister" },
  ]);
  assert.equal(second.additionalRelationships[0].relativeClientId, "first");
});

test("switching from single to batch preserves additional relationship selections", () => {
  const html = renderToStaticMarkup(createElement(BatchPersonDialog, {
    family: demoFamily, focusPersonId: demoFamily.people[0].id, busy: false, errorMessage: "",
    initialPerson: { ...createBatchPersonDraft("ignored", demoFamily.people[0].id), additionalRelationships: [
      { relationshipKind: "child", relativePersonId: demoFamily.people[1].id },
    ] }, onClose: () => {}, onSubmit: async () => {},
  }));
  assert.match(html, /Связь 2/);
  assert.match(html, new RegExp(`value="existing:${demoFamily.people[1].id}" selected=""`));
});
