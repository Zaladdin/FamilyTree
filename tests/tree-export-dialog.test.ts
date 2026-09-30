import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TreeExportDialog } from "@/components/tree-export-dialog";
import { getFamilyBySlug } from "@/lib/mock-data";
import { buildFamilyRadialLayout } from "@/lib/family-radial-layout";

function fixture() {
  const family = getFamilyBySlug("akhmedov");
  assert.ok(family);
  return { family, layout: buildFamilyRadialLayout(family, null), onClose: () => {} };
}

test("closed tree export does not add controls or expose family data to the page", () => {
  assert.equal(renderToStaticMarkup(createElement(TreeExportDialog, { ...fixture(), open: false })), "");
});

test("open export has a labelled native dialog, style select, download actions and local-only privacy note", () => {
  const markup = renderToStaticMarkup(createElement(TreeExportDialog, { ...fixture(), open: true }));
  assert.match(markup, /<dialog\b[^>]*aria-labelledby="[^"]+"[^>]*aria-describedby="[^"]+"[^>]*aria-modal="true"/);
  assert.match(markup, /<button\b[^>]*type="button"[^>]*aria-label="Закрыть экспорт дерева"/);
  const label = markup.match(/<label for="([^"]+)">Оформление<\/label>/);
  assert.ok(label);
  assert.ok(markup.includes(`<select id="${label[1]}"`));
  assert.match(markup, /<option value="tree" selected="">Живое дерево<\/option>/);
  assert.match(markup, /<option value="circle">Круговая схема<\/option>/);
  assert.match(markup, /<option value="pyramid">Пирамида<\/option>/);
  assert.match(markup, /Скачать PNG/);
  assert.match(markup, /Скачать PDF/);
  assert.match(markup, /Людей в экспорте: 8/);
  assert.match(markup, /Данные семьи не отправляются во внешние сервисы/);
  assert.doesNotMatch(markup, /<script|<iframe|<foreignObject|data:image|<input/);
});

test("empty export clearly explains scope and disables both downloads", () => {
  const props = fixture();
  const markup = renderToStaticMarkup(createElement(TreeExportDialog, { ...props, family: { ...props.family, people: [], relationships: [] }, open: true, layout: { ...props.layout, nodes: [], links: [] } }));
  assert.match(markup, /В этом виде дерева нет людей/);
  const downloads = [...markup.matchAll(/<button\b[^>]*class="tree-export-download[^>]*>/g)].map((match) => match[0]);
  assert.equal(downloads.length, 2);
  assert.ok(downloads.every((button) => button.includes('disabled=""')));
});

test("tree export perspective is a labelled local selector with all family people and current selection as default", () => {
  const props = fixture();
  const focused = buildFamilyRadialLayout(props.family, "timur");
  const hiddenContextLayout = { ...focused, nodes: focused.nodes.filter((node) => node.person.id === "timur"), links: [] };
  const markup = renderToStaticMarkup(createElement(TreeExportDialog, { ...props, layout: hiddenContextLayout, open: true }));
  const label = markup.match(/<label for="([^"]+)">Относительно кого<\/label>/);
  assert.ok(label, "person selector must have a connected visible label");
  const select = [...markup.matchAll(/<select\b[\s\S]*?<\/select>/g)].find((match) => match[0].includes(`id="${label[1]}"`))?.[0];
  assert.ok(select);
  assert.match(select, /<option value="timur" selected="">/);
  for (const person of props.family.people) assert.ok(select.includes(`value="${person.id}"`), "hidden context people remain available as an export perspective");
  assert.match(markup, /только к экспорту/);
  assert.match(markup, /старшие известные предки/);
  assert.match(markup, /корней/);
  assert.match(markup, /потомки/);
  assert.match(markup, /Людей в экспорте: 8/, "branch count comes from the export renderer, not the one visible canvas node");
  assert.doesNotMatch(markup, /Скрытые люди не попадут в файл/);
});

test("tree export chooses the first family person when the canvas has no selected person", () => {
  const props = fixture();
  const markup = renderToStaticMarkup(createElement(TreeExportDialog, { ...props, open: true }));
  assert.ok(markup.includes(`<option value="${props.family.people[0].id}" selected="">`));
});
