import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Module, { createRequire } from "node:module";
import path from "node:path";

const requireTest = createRequire(path.resolve("tests/route-states.test.ts"));
const restored = new Map<string, NodeModule | undefined>();
function stub(name: string, exports: unknown) {
  const id = requireTest.resolve(name);
  restored.set(id, requireTest.cache[id]);
  const loadedModule = new Module(id);
  loadedModule.exports = exports;
  loadedModule.loaded = true;
  requireTest.cache[id] = loadedModule;
}
const extensions = requireTest.extensions;
const previousCss = extensions[".css"];
extensions[".css"] = (module) => { module.exports = { screen: "screen", card: "card" }; };
stub("next/navigation", { useRouter: () => ({ refresh() {} }) });
after(() => {
  if (previousCss) extensions[".css"] = previousCss;
  else delete extensions[".css"];
  for (const [id, previous] of restored) {
    if (previous) requireTest.cache[id] = previous;
    else delete requireTest.cache[id];
  }
});

const RootError: typeof import("../app/error").default = requireTest("../app/error").default;
const FamilyError: typeof import("../app/family/[slug]/error").default = requireTest("../app/family/[slug]/error").default;
const RootLoading: typeof import("../app/loading").default = requireTest("../app/loading").default;
const FamilyLoading: typeof import("../app/family/[slug]/loading").default = requireTest("../app/family/[slug]/loading").default;

test("root error offers retry and navigation without exposing the original error", () => {
  const error = Object.assign(new Error("private-family-and-database-details"), { digest: "private-digest" });
  const html = renderToStaticMarkup(createElement(RootError, { error, reset() {} }));
  assert.match(html, /Не удалось открыть страницу/);
  assert.match(html, /<button[^>]*type="button"[^>]*>Попробовать снова<\/button>/);
  assert.match(html, /href="\/families"/);
  assert.match(html, /aria-labelledby="[^"]+"/);
  assert.doesNotMatch(html, /private-family|private-digest|Error:|postgresql/);
});

test("family error explains loading failure without claiming that writes succeeded", () => {
  const html = renderToStaticMarkup(createElement(FamilyError, {
    error: new Error("private-data"), reset() {},
  }));
  assert.match(html, /Не удалось открыть семейный архив/);
  assert.match(html, /Попробовать снова/);
  assert.doesNotMatch(html, /private-data|успешно сохран|все данные сохран/);
});

test("loading screens announce progress and hide noninteractive skeletons from assistive technology", () => {
  for (const [Component, label] of [[RootLoading, "Загружаем страницу"], [FamilyLoading, "Загружаем семейный архив"]] as const) {
    const html = renderToStaticMarkup(createElement(Component));
    assert.ok(html.includes(label));
    assert.match(html, /role="status"/);
    assert.match(html, /aria-hidden="true"/);
    assert.doesNotMatch(html, /<button|<input|<select|tabindex=|private-data/);
  }
});
