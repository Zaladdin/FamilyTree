import test, { after } from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFamilyBySlug } from "../lib/mock-data";

const requireTest = createRequire(path.resolve("tests/family-section-performance.test.ts"));
const originals = new Map<string, NodeModule | undefined>();
function replace(name: string, exports: unknown) {
  const id = requireTest.resolve(name);
  originals.set(id, requireTest.cache[id]);
  const module = new Module(id);
  module.exports = exports;
  module.loaded = true;
  requireTest.cache[id] = module;
}
after(() => { for (const [id, original] of originals) { if (original) requireTest.cache[id] = original; else delete requireTest.cache[id]; } });

const actualLayout: typeof import("../lib/family-display-layout") = requireTest("../lib/family-display-layout");
const actualKinship: typeof import("../lib/family-kinship") = requireTest("../lib/family-kinship");
let layouts = 0;
let kinships = 0;
replace("../lib/family-display-layout", { ...actualLayout, buildFamilyDisplayLayout: (...args: Parameters<typeof actualLayout.buildFamilyDisplayLayout>) => { layouts++; return actualLayout.buildFamilyDisplayLayout(...args); } });
replace("../lib/family-kinship", { ...actualKinship, getFamilyKinship: (...args: Parameters<typeof actualKinship.getFamilyKinship>) => { kinships++; return actualKinship.getFamilyKinship(...args); } });
const { FamilyWorkspace }: typeof import("../components/family-workspace") = requireTest("../components/family-workspace");

test("non-tree sections skip graph geometry and kinship work while tree retains it", () => {
  const family = getFamilyBySlug("akhmedov")!;
  for (const section of ["people", "memories", "photos"] as const) {
    layouts = 0; kinships = 0;
    const html = renderToStaticMarkup(createElement(FamilyWorkspace, { family, focusPersonId: "timur", canEdit: false, canvasScale: 1, section }));
    assert.ok(html.includes('id="people-panel"'));
    assert.equal(layouts, 0, `${section} must not build hidden tree geometry`);
    assert.equal(kinships, 0, `${section} must not traverse hidden tree kinship`);
  }
  layouts = 0; kinships = 0;
  renderToStaticMarkup(createElement(FamilyWorkspace, { family, focusPersonId: "timur", canEdit: false, canvasScale: 1 }));
  assert.ok(layouts > 0 && kinships > 0);
});
