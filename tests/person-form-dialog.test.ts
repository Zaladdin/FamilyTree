import test from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonFormDialog } from "@/components/person-form-dialog";

function attr(tag: string, name: string) {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
}

function dialogElement(props: Omit<ComponentProps<typeof PersonFormDialog>, "children">, children: ReactNode) {
  // createElement supplies the required children through its third argument.
  return createElement(PersonFormDialog, props as ComponentProps<typeof PersonFormDialog>, children);
}

function markup(busy?: boolean) {
  return renderToStaticMarkup(dialogElement({
    title: "Добавить человека",
    description: "Укажите основные данные и связь с семьёй.",
    busy,
    onClose: () => {},
  }, createElement("form", { "data-testid": "person-form" },
      createElement("label", null, "Имя", createElement("input", { name: "firstName", required: true, "data-autofocus": true })),
      createElement("details", null,
        createElement("summary", null, "Дополнительно"),
        createElement("textarea", { name: "biography", defaultValue: "Необязательная биография" })),
      createElement("button", { type: "submit" }, "Добавить"))));
}

test("person dialog is closed during SSR and does not require a browser document", () => {
  assert.equal(typeof document, "undefined");
  const html = markup();
  const dialogs = html.match(/<dialog\b[^>]*>/g) ?? [];
  assert.equal(dialogs.length, 1);
  assert.ok(!/\sopen(?:\s|=|>)/.test(dialogs[0]), "native showModal must open only after the client mounts");
  assert.equal(attr(dialogs[0], "aria-modal"), "true");
  assert.equal(attr(dialogs[0], "aria-busy"), "false");
});

test("dialog accessible name and description reference the actual rendered heading and text", () => {
  const html = markup();
  const dialog = html.match(/<dialog\b[^>]*>/)?.[0];
  const heading = html.match(/<h2\b[^>]*>/)?.[0];
  const description = html.match(/<p\b[^>]*>/)?.[0];
  assert.ok(dialog && heading && description);
  const titleId = attr(dialog, "aria-labelledby");
  const descriptionId = attr(dialog, "aria-describedby");
  assert.ok(titleId && descriptionId);
  assert.notEqual(titleId, descriptionId);
  assert.equal(attr(heading, "id"), titleId);
  assert.equal(attr(description, "id"), descriptionId);
  assert.ok(html.includes(`${heading}Добавить человека</h2>`));
  assert.ok(html.includes(`${description}Укажите основные данные и связь с семьёй.</p>`));
});

test("dialog retains one child form, its initial-focus marker, and collapsed optional fields", () => {
  const html = markup();
  assert.equal((html.match(/<form\b/g) ?? []).length, 1, "dialog shell must not create a nested form");
  const form = html.match(/<form\b[^>]*>/)?.[0];
  const input = html.match(/<input\b[^>]*>/)?.[0];
  const details = html.match(/<details\b[^>]*>/)?.[0];
  assert.ok(form && input && details);
  assert.equal(attr(form, "data-testid"), "person-form");
  assert.equal(attr(input, "name"), "firstName");
  assert.equal(attr(input, "required"), "");
  assert.equal(attr(input, "data-autofocus"), "true");
  assert.ok(!/\sopen(?:\s|=|>)/.test(details));
  assert.ok(html.includes("Необязательная биография"));
  assert.ok(html.includes('<button type="submit">Добавить</button>'));
});

test("busy dialog announces pending work and disables its named non-submit close button", () => {
  for (const busy of [false, true]) {
    const html = markup(busy);
    const dialog = html.match(/<dialog\b[^>]*>/)?.[0];
    const close = (html.match(/<button\b[^>]*>/g) ?? []).find((tag) => attr(tag, "aria-label") === "Закрыть форму добавления человека");
    assert.ok(dialog && close);
    assert.equal(attr(dialog, "aria-busy"), String(busy));
    assert.equal(attr(close, "type"), "button");
    assert.equal(attr(close, "disabled"), busy ? "" : undefined);
    assert.ok(html.includes('<span aria-hidden="true">×</span>'));
  }
});

test("separate dialog instances have independent accessible IDs", () => {
  const html = renderToStaticMarkup(createElement("div", null,
    ...["Первый", "Второй"].map((title) => dialogElement({
      title, description: `Описание: ${title}`, onClose: () => {},
    }, createElement("form"))),
  ));
  const dialogs = html.match(/<dialog\b[^>]*>/g) ?? [];
  assert.equal(dialogs.length, 2);
  const referencedIds = dialogs.flatMap((tag) => [attr(tag, "aria-labelledby"), attr(tag, "aria-describedby")]);
  assert.ok(referencedIds.every(Boolean));
  assert.equal(new Set(referencedIds).size, 4);
  for (const id of referencedIds) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1);
  }
});
