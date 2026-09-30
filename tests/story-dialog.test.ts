import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StoryChangeDialog } from "@/components/story-dialog";
import { getFamilyBySlug } from "@/lib/mock-data";
import type { Story } from "@/lib/types";

const person = getFamilyBySlug("akhmedov")!.people[0];
const story: Story = { id: "story", version: 3, title: "Семейная поездка", body: "Первая строка\n\nВторая строка <b>текст</b>", narrator: "Рассказчик", createdAt: "2026-01-01T00:00:00.000Z" };
const callbacks = { onClose: () => {}, onSuccess: () => {}, onRefresh: () => {}, onDirtyChange: () => {}, onBusyChange: () => {} };

test("story editor preserves paragraph values and exposes labelled bounded fields in one native dialog", () => {
  const html = renderToStaticMarkup(createElement(StoryChangeDialog, { slug: "test", subject: person, mode: "edit", story, ...callbacks }));
  assert.match(html, /<dialog/);
  assert.equal((html.match(/<form\b/g) ?? []).length, 1);
  assert.match(html, /Редактировать историю/);
  assert.match(html, /Первая строка\n\nВторая строка &lt;b&gt;текст&lt;\/b&gt;/);
  assert.match(html, /name="body"[^>]*maxLength="12000"/i);
  assert.match(html, /Сохранить изменения/);
  assert.doesNotMatch(html, /<b>текст/);
});

test("delete and restore dialogs identify the story and explain recoverability", () => {
  const removed = renderToStaticMarkup(createElement(StoryChangeDialog, { slug: "test", subject: person, mode: "delete", story, ...callbacks }));
  const restored = renderToStaticMarkup(createElement(StoryChangeDialog, { slug: "test", subject: person, mode: "restore", story, ...callbacks }));
  assert.match(removed, /Семейная поездка/);
  assert.match(removed, /можно восстановить/);
  assert.match(restored, /Восстановить историю/);
  assert.match(restored, /Семейная поездка/);
  assert.doesNotMatch(removed, /<textarea/);
});
