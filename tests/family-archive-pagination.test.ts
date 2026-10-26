import test, { after } from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFamilyBySlug } from "../lib/mock-data";

const requireTest = createRequire(path.resolve("tests/family-archive-pagination.test.ts"));
const navId = requireTest.resolve("next/navigation");
const previous = requireTest.cache[navId];
const nav = new Module(navId);
nav.exports = { useRouter: () => ({ push() {}, refresh() {} }) }; nav.loaded = true;
requireTest.cache[navId] = nav;
after(() => { if (previous) requireTest.cache[navId] = previous; else delete requireTest.cache[navId]; });
const { FamilyArchive }: typeof import("../components/family-archive") = requireTest("../components/family-archive");

function markup(canManage: boolean, filtered = false, hasPeople = true) {
  const family = structuredClone(getFamilyBySlug("akhmedov")!);
  family.archivedPeople = hasPeople ? [family.people[0]] : [];
  const props = { family, canManage, backHref: "/family/akhmedov", pagination: {
    previousCursor: "before&one", nextCursor: "after/two", isFiltered: filtered,
  } } as ComponentProps<typeof FamilyArchive>;
  return renderToStaticMarkup(createElement(FamilyArchive, props));
}

test("archive pagination uses accessible encoded previous/next links and never changes restore rights", () => {
  for (const canManage of [false, true]) {
    const html = markup(canManage);
    assert.match(html, /aria-label="Страницы архива"/);
    assert.ok(html.includes('/family/akhmedov/archive?before=before%26one'));
    assert.ok(html.includes('/family/akhmedov/archive?after=after%2Ftwo'));
    assert.equal(html.includes(">Восстановить</button>"), canManage);
  }
});

test("a now-empty cursor page offers recovery instead of claiming the entire family archive is empty", () => {
  const html = markup(false, true, false);
  assert.match(html, /На этой странице больше нет записей/);
  assert.doesNotMatch(html, /Архив пуст|Сейчас все люди находятся в активном дереве/);
  assert.ok(html.includes('href="/family/akhmedov/archive"'));
});
