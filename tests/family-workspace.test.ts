import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FamilyWorkspace } from "@/components/family-workspace";
import { getFamilyBySlug } from "@/lib/mock-data";

function fixtureFamily() {
  const source = getFamilyBySlug("akhmedov");
  assert.ok(source);
  const family = structuredClone(source);
  const timur = family.people.find((person) => person.id === "timur");
  assert.ok(timur);
  timur.biography = "Личная биография для проверки выбранной карточки";
  timur.timeline = ["Личное событие выбранного человека"];
  timur.stories = [{ id: "ssr-story", title: "История выбранной карточки", body: "Личный текст воспоминания", createdAt: "2026-01-01T00:00:00.000Z" }];
  timur.mediaAssets = [{ id: "ssr-audio", type: "audio", title: "Личная аудиозапись", url: "/api/test-fixtures/private-audio", mimeType: "audio/mpeg", size: 100, createdAt: "2026-01-01T00:00:00.000Z" }];
  return family;
}

test("story controls follow editing rights, deleted stories stay outside the active count, and user paragraphs remain plain text", () => {
  const family = fixtureFamily();
  const person = family.people.find((item) => item.id === "timur")!;
  person.biography = "Первая строка\n\nВторой абзац";
  person.note = "Заметка\n<script>alert('no')</script>";
  person.stories[0].body = "Начало\n\nКонец <b>обычный текст</b>";
  Object.assign(person, { deletedStories: [{ id: "deleted-story", title: "Удалённое воспоминание", body: "Сохранённый текст", createdAt: "2026-01-01T00:00:00.000Z", version: 1, deletedAt: "2026-02-01T00:00:00.000Z" }] });
  for (const canEdit of [false, true]) {
    const markup = renderToStaticMarkup(createElement(FamilyWorkspace, {
      family, focusPersonId: "timur", canEdit, canvasScale: 1,
      onEditStory: () => {}, onDeleteStory: () => {}, onRestoreStory: () => {},
    }));
    assert.match(markup, /class="[^"]*user-text[^"]*"/);
    assert.match(markup, /Начало\n\nКонец &lt;b&gt;обычный текст&lt;\/b&gt;/);
    assert.doesNotMatch(markup, /<script>|<b>обычный текст/);
    assert.equal(markup.includes("Редактировать историю: История выбранной карточки"), canEdit);
    assert.equal(markup.includes("Удалить историю: История выбранной карточки"), canEdit);
    assert.equal(markup.includes("Восстановить историю: Удалённое воспоминание"), canEdit);
    assert.equal(markup.includes("Удалённые истории (1)"), canEdit);
    assert.equal(person.stories.length, 1);
  }
});

// Inspect the emitted HTML, not component source or a duplicated layout algorithm.
function tags(markup: string, name: string) {
  return markup.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];
}

function attr(tag: string, name: string) {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
}

function hasClass(tag: string, name: string) {
  return (attr(tag, "class") ?? "").split(/\s+/).includes(name);
}

function renderedPeople(markup: string) {
  return tags(markup, "button").filter((tag) => attr(tag, "data-person-id") !== undefined);
}

test("archive desk retains working navigation and account actions without exposing private routes in demo", () => {
  for (const demo of [false, true]) {
    const markup = renderToStaticMarkup(createElement(FamilyWorkspace, {
      family: fixtureFamily(), focusPersonId: "timur", canEdit: false, canvasScale: 1, demo,
    }));
    const hrefs = tags(markup, "a").map((tag) => attr(tag, "href"));
    assert.ok(hrefs.includes("#photo-panel") && hrefs.includes("#people-panel"));
    assert.equal(hrefs.includes("/account"), !demo);
    assert.equal(hrefs.includes("/families"), !demo);
    assert.equal(hrefs.includes("/register"), demo);
    const logout = tags(markup, "form").find((tag) => attr(tag, "action") === "/api/auth/logout");
    assert.equal(Boolean(logout), !demo);
    if (logout) assert.equal(attr(logout, "method"), "post");
    assert.ok(markup.includes('class="tree-bottom-controls"'));
  }
});

function visibilityCheckbox(markup: string) {
  const inputs = tags(markup, "input");
  assert.equal(inputs.filter((tag) => attr(tag, "type") === "radio").length, 0);
  const checkboxes = inputs.filter((tag) => attr(tag, "type") === "checkbox");
  assert.equal(checkboxes.length, 1, "visibility is controlled by one checkbox");
  const input = checkboxes[0];
  assert.equal(attr(input, "name"), "tree-hide-others");
  const labels = markup.match(/<label\b[^>]*>[\s\S]*?<\/label>/g) ?? [];
  assert.ok(labels.some((label) => label.includes(input) && label.includes("Скрыть остальных")));
  return input;
}

test("selected-person inspector has its own accessible close button for viewers and editors only while selected", () => {
  for (const canEdit of [false, true]) {
    for (const focusPersonId of [null, "timur", "missing"]) {
      const markup = renderToStaticMarkup(createElement(FamilyWorkspace, {
        family: fixtureFamily(), focusPersonId, canEdit, canvasScale: 1,
      }));
      const closeButtons = tags(markup, "button").filter((tag) => attr(tag, "aria-label") === "Закрыть карточку человека");
      assert.equal(closeButtons.length, focusPersonId === "timur" ? 1 : 0);
      if (focusPersonId === "timur") {
        const panel = markup.match(/<aside\b[^>]*aria-label="Карточка выбранного человека"[\s\S]*?<\/aside>/)?.[0];
        assert.ok(panel?.includes(closeButtons[0]), "close action belongs inside the selected person's panel");
        assert.equal(attr(closeButtons[0], "type"), "button");
        assert.ok(hasClass(closeButtons[0], "tree-inspector-close"));
      }
    }
  }
});

test("tree offers export, reset positions and keyboard move instructions without changing selection semantics", () => {
  const markup = renderToStaticMarkup(createElement(FamilyWorkspace, {
    family: fixtureFamily(), focusPersonId: "timur", canEdit: false, canvasScale: 1,
  }));
  assert.ok(markup.includes("Экспорт PNG / PDF"));
  assert.ok(markup.includes("Сбросить расположение"));
  const people = renderedPeople(markup);
  assert.equal(people.length, 8);
  for (const tag of people) {
    assert.equal(attr(tag, "aria-describedby"), "tree-move-help");
    assert.match(attr(tag, "aria-keyshortcuts") ?? "", /Shift\+ArrowUp/);
  }
  assert.ok(markup.includes('id="tree-move-help"'));
  assert.ok(markup.includes("Shift + стрелки"));
});

test("view controls offer four layouts without removing the existing circle or single visibility checkbox", () => {
  const markup = renderToStaticMarkup(createElement(FamilyWorkspace, {
    family: fixtureFamily(), focusPersonId: "timur", canEdit: false, canvasScale: 1,
  }));
  const controls = markup.match(/<div\b[^>]*role="group"[^>]*aria-label="Вид дерева"[\s\S]*?<\/div>/)?.[0];
  assert.ok(controls, "the view switch needs an accessible group label");
  const buttons = tags(controls, "button");
  assert.equal(buttons.length, 4);
  assert.ok(controls.includes("Круг"));
  assert.ok(controls.includes("Пирамида"));
  assert.ok(controls.includes("Поколения"));
  assert.ok(controls.includes("Слева направо"));
  assert.deepEqual(buttons.map((tag) => attr(tag, "aria-pressed")), ["false", "false", "true", "false"]);
  assert.ok(buttons.every((tag) => attr(tag, "type") === "button"));
  assert.equal(renderedPeople(markup).length, 8);
  assert.match(markup, /data-tree-layout="generations"/);
  visibilityCheckbox(markup);
});

test("SSR defaults to all eight people in generation cards with one accessible selection", () => {
  const family = fixtureFamily();
  const markup = renderToStaticMarkup(createElement(FamilyWorkspace, {
    family, focusPersonId: "timur", canEdit: false, canvasScale: 1,
  }));
  const people = renderedPeople(markup);
  assert.equal(people.length, 8);
  assert.deepEqual(people.map((tag) => attr(tag, "data-person-id")).sort(), family.people.map((person) => person.id).sort());
  for (const tag of people) {
    const width = Number(attr(tag, "style")?.match(/(?:^|;)width:([\d.]+)px/)?.[1]);
    const height = Number(attr(tag, "style")?.match(/(?:^|;)height:([\d.]+)px/)?.[1]);
    assert.ok(width > height, "generation cards are horizontal and compact");
    assert.ok(hasClass(tag, "gene-node-card"));
  }
  const selected = people.filter((tag) => attr(tag, "aria-pressed") === "true");
  assert.equal(selected.length, 1);
  assert.equal(attr(selected[0], "data-person-id"), "timur");
  assert.ok(hasClass(selected[0], "is-focus"));
  const checkbox = visibilityCheckbox(markup);
  assert.equal(attr(checkbox, "checked"), undefined);
  assert.equal(attr(checkbox, "disabled"), undefined);
  assert.ok(tags(markup, "aside").some((tag) => attr(tag, "aria-label") === "Карточка выбранного человека"));
  assert.ok(markup.includes("Личная биография для проверки выбранной карточки"));
  assert.ok(markup.includes("Личный текст воспоминания"));
  assert.ok(markup.includes('id="tree-perspective-person"'));
  assert.ok(markup.includes("Родство относительно"));
  assert.ok(markup.includes('value="timur" selected=""'));
  const grandfather = people.find((tag) => attr(tag, "data-person-id") === "magomed");
  assert.ok(grandfather);
  assert.match(attr(grandfather, "aria-label") ?? "", /дедушка/);
  assert.match(attr(grandfather, "title") ?? "", /Связь:/);
  assert.ok(markup.includes('class="gene-node-role">Дедушка</small>'), "derived role is present even on compact nodes");
});

test("SSR with no selection keeps all eight people and removes personal panels and stale media", () => {
  const markup = renderToStaticMarkup(createElement(FamilyWorkspace, {
    family: fixtureFamily(), focusPersonId: null, canEdit: false, canvasScale: 1,
  }));
  const people = renderedPeople(markup);
  assert.equal(people.length, 8);
  assert.ok(people.every((tag) => attr(tag, "aria-pressed") === "false" && !hasClass(tag, "is-focus")));
  assert.ok(people.every((tag) => !hasClass(tag, "is-context")), "clearing selection restores full-size cards for everyone");
  assert.ok(tags(markup, "section").some((tag) => hasClass(tag, "tree-canvas-shell") && hasClass(tag, "is-overview")));
  assert.ok(!tags(markup, "aside").some((tag) => hasClass(tag, "tree-inspector")));
  const checkbox = visibilityCheckbox(markup);
  assert.equal(attr(checkbox, "disabled"), "");
  assert.equal(attr(checkbox, "checked"), undefined);
  assert.ok(tags(markup, "section").some((tag) => hasClass(tag, "family-overview-note")));
  for (const privateContent of ["Личная биография для проверки выбранной карточки", "Личное событие выбранного человека", "Личный текст воспоминания", "Личная аудиозапись", "/api/test-fixtures/private-audio"]) {
    assert.ok(!markup.includes(privateContent), `unselected overview leaked ${privateContent}`);
  }
  assert.equal(tags(markup, "audio").length, 0);
  assert.ok(markup.includes('value="" selected=""'));
  assert.ok(markup.includes("Выберите человека, чтобы увидеть названия родства."));
  assert.ok(!markup.includes('class="gene-node-role"'), "unselected overview never implies an absolute kinship label");
});

test("SSR overview keeps family navigation available while demo hides private archive routes", () => {
  const family = fixtureFamily();
  for (const demo of [false, true]) {
    const markup = renderToStaticMarkup(createElement(FamilyWorkspace, {
      family, focusPersonId: null, canEdit: false, canvasScale: 1, demo,
    }));
    const hrefs = tags(markup, "a").map((tag) => attr(tag, "href"));
    for (const section of ["archive", "journal", "members"]) {
      assert.equal(hrefs.includes(`/family/${family.slug}/${section}`), !demo);
    }
    const hasFamilyNavigation = tags(markup, "nav").some((tag) => attr(tag, "aria-label") === "Управление семейным архивом");
    assert.equal(hasFamilyNavigation, !demo);
  }
});

test("SSR empty family shows the first-person action and preserves the add-form slot", () => {
  const family = fixtureFamily();
  family.people = [];
  family.relationships = [];
  family.stats.people = 0;
  const markup = renderToStaticMarkup(createElement(FamilyWorkspace, {
    family, focusPersonId: null, canEdit: true, canvasScale: 1,
    addPersonSheet: createElement("div", { "data-testid": "first-person-form" }, "Форма первого человека"),
  }));
  assert.ok(markup.includes("В этой семье пока нет людей"));
  assert.ok(markup.includes("Добавить первого человека"));
  assert.ok(tags(markup, "div").some((tag) => attr(tag, "data-testid") === "first-person-form"));
  assert.equal(renderedPeople(markup).length, 0);
  assert.ok(!tags(markup, "aside").some((tag) => hasClass(tag, "tree-inspector")));
});

test("existing-person relationship action is available only on an editable selected card", () => {
  for (const canEdit of [false, true]) {
    for (const focusPersonId of [null, "timur"]) {
      const markup = renderToStaticMarkup(createElement(FamilyWorkspace, {
        family: fixtureFamily(), focusPersonId, canEdit, canvasScale: 1,
        onOpenAddRelationship: () => {},
      }));
      assert.equal(markup.includes("Связи человека"), canEdit && focusPersonId !== null);
    }
  }
});

test("SSR shows in-laws in both the tree and relatives panel for the selected perspective", () => {
  const family = fixtureFamily();
  const template = family.people[0];
  family.people = [
    { ...template, id: "husband", firstName: "Иван", gender: "male" },
    { ...template, id: "wife", firstName: "Анна", gender: "female" },
    { ...template, id: "wife-father", firstName: "Пётр", gender: "male" },
    { ...template, id: "wife-mother", firstName: "Ольга", gender: "female" },
    { ...template, id: "husband-father", firstName: "Олег", gender: "male" },
  ];
  family.relationships = [
    { type: "spouse", fromPersonId: "husband", toPersonId: "wife" },
    { type: "parent", fromPersonId: "wife-father", toPersonId: "wife" },
    { type: "parent", fromPersonId: "wife-mother", toPersonId: "wife" },
    { type: "parent", fromPersonId: "husband-father", toPersonId: "husband" },
  ];
  for (const [focusPersonId, targetId, role] of [["husband", "wife-father", "Тесть"], ["husband", "wife-mother", "Тёща"], ["husband-father", "wife", "Невестка"]]) {
    const markup = renderToStaticMarkup(createElement(FamilyWorkspace, { family, focusPersonId, canEdit: false, canvasScale: 1 }));
    const target = renderedPeople(markup).find((tag) => attr(tag, "data-person-id") === targetId);
    assert.ok(target);
    assert.ok((attr(target, "aria-label") ?? "").endsWith(role.toLowerCase()));
    assert.ok(markup.includes(`class="gene-node-role">${role}</small>`));
    assert.ok(markup.includes(`<small>${role}</small><strong>`), "in-laws must not be lost to a six-badge limit");
  }
});

test("SSR renders generation cards with distinct recorded relationship lines", () => {
  const markup = renderToStaticMarkup(createElement(FamilyWorkspace, {
    family: fixtureFamily(), focusPersonId: "timur", canEdit: false, canvasScale: 1,
  }));
  assert.ok(tags(markup, "div").some((tag) => attr(tag, "data-tree-layout") === "generations"));
  assert.ok(renderedPeople(markup).every((tag) => hasClass(tag, "gene-node-card")));
  const decoration = tags(markup, "svg").find((tag) => hasClass(tag, "tree-links-svg"));
  assert.ok(decoration);
  assert.equal(attr(decoration, "aria-hidden"), "true");
  const links = tags(markup, "path").filter((tag) => hasClass(tag, "tree-relation"));
  assert.ok(links.some((tag) => hasClass(tag, "is-parent")));
  assert.ok(links.some((tag) => hasClass(tag, "is-spouse")));
  assert.ok(links.every((tag) => /[LHV]/.test(attr(tag, "d") ?? "")), "generation connections use orthogonal family branches");
});

test("SSR distinguishes a direct sibling link from marriage and parenthood in the tree legend", () => {
  const family = fixtureFamily();
  family.relationships = [{ type: "sibling", fromPersonId: "timur", toPersonId: "ilyas" }];
  family.people = family.people.filter((person) => person.id === "timur" || person.id === "ilyas");
  const markup = renderToStaticMarkup(createElement(FamilyWorkspace, { family, focusPersonId: "timur", canEdit: false, canvasScale: 1 }));
  const links = tags(markup, "path").filter((tag) => hasClass(tag, "tree-relation"));
  assert.equal(links.length, 1);
  assert.ok(hasClass(links[0], "is-sibling"));
  assert.ok(!hasClass(links[0], "is-spouse") && !hasClass(links[0], "is-parent"));
  assert.match(markup, /tree-legend-dot is-sibling[^>]*><\/i>Братья и сёстры/);
});
