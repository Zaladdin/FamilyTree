import test, { after } from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import path from "node:path";
import type { ReactElement } from "react";

const requireTest = createRequire(path.resolve("tests/family-section-page.test.ts"));
const previousModules = new Map<string, NodeModule | undefined>();
function stubModule(name: string, exports: unknown) {
  const id = requireTest.resolve(name);
  previousModules.set(id, requireTest.cache[id]);
  const module = new Module(id);
  module.exports = exports;
  module.loaded = true;
  requireTest.cache[id] = module;
}
after(() => {
  for (const [id, previous] of previousModules) {
    if (previous) requireTest.cache[id] = previous;
    else delete requireTest.cache[id];
  }
});

let loggedIn = true;
let role: string | null = "viewer";
let missingFamily = false;
const reads: unknown[][] = [];
stubModule("../lib/auth", {
  getCurrentUser: async () => loggedIn ? { id: "user" } : null,
  getFamilyRoleForUserId: async () => role,
  normalizeSafeRedirectPath: (value: string) => value,
});
const readFamily = async (...args: unknown[]) => {
    reads.push(args);
    return missingFamily ? null : { people: [{ id: "known" }] };
};
stubModule("../lib/family-repository", { getFamilyBySlug: readFamily });
stubModule("../lib/family-workspace-reader", { getFamilyWorkspaceBySlug: readFamily });
stubModule("../components/family-app", { FamilyApp: () => null });
stubModule("next/navigation", {
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
  notFound: () => { throw new Error("not-found"); },
});
const { FamilySectionPage }: typeof import("../components/family-section-page") = requireTest("../components/family-section-page");

for (const section of ["people", "memories", "photos"] as const) {
  test(`${section} page enforces authentication, membership and role before exposing family data`, async () => {
    const props = { params: Promise.resolve({ slug: "unit" }), searchParams: Promise.resolve({ person: "known" }), section };
    reads.length = 0;
    loggedIn = false;
    await assert.rejects(FamilySectionPage(props), {
      message: `redirect:/login?redirectTo=${encodeURIComponent(`/family/unit/${section}?person=known`)}`,
    });
    assert.equal(reads.length, 0);
    loggedIn = true;
    role = null;
    await assert.rejects(FamilySectionPage(props), { message: "not-found" });
    assert.equal(reads.length, 0);

    for (const viewerRole of ["viewer", "owner", "admin", "editor"]) {
      role = viewerRole;
      const result = await FamilySectionPage(props);
      const app = result.props.children as ReactElement<{ canEdit: boolean; section: string; initialFocusPersonId: string | null }>;
      assert.equal(app.props.canEdit, viewerRole !== "viewer");
      assert.equal(app.props.section, section);
      assert.equal(app.props.initialFocusPersonId, "known");
      assert.deepEqual(reads.at(-1), ["unit", "known", { canEdit: viewerRole !== "viewer" }]);
    }
    const unknown = await FamilySectionPage({ ...props, searchParams: Promise.resolve({ person: "unknown" }) });
    assert.equal(unknown.props.children.props.initialFocusPersonId, null);
    missingFamily = true;
    await assert.rejects(FamilySectionPage(props), { message: "not-found" });
    missingFamily = false;
  });
}
