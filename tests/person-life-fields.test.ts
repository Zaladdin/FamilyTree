import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonLifeFields } from "@/components/person-life-fields";

test("deceased checkbox reveals a required labelled death date only when checked", () => {
  for (const status of ["living", "deceased"] as const) {
    const html = renderToStaticMarkup(createElement(PersonLifeFields, { status, deathDate: "2001", onChange: () => {} }));
    assert.match(html, /Человек умер/);
    const checkbox = html.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0];
    assert.ok(checkbox);
    assert.equal(checkbox.includes('checked=""'), status === "deceased");
    const date = html.match(/<input[^>]*name="deathDate"[^>]*>/)?.[0];
    assert.equal(Boolean(date), status === "deceased");
    if (date) { assert.match(date, /required=""/); assert.match(html, /Дата смерти/); }
  }
});
