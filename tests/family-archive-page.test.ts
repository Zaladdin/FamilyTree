import test, { after } from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import path from "node:path";
import type { ReactElement } from "react";

const requireTest = createRequire(path.resolve("tests/family-archive-page.test.ts"));
const previousModules = new Map<string, NodeModule | undefined>();
function stubModule(name: string, exports: unknown) {
  const id = requireTest.resolve(name);
  previousModules.set(id, requireTest.cache[id]);
  const module = new Module(id);
  module.exports = exports;
  module.loaded = true;
  requireTest.cache[id] = module;
}
after(() => { for (const [id, previous] of previousModules) {
  if (previous) requireTest.cache[id] = previous; else delete requireTest.cache[id];
} });

let loggedIn = true;
let role: string | null = "guest";
let missing = false;
const reads: unknown[][] = [];
stubModule("../lib/auth", {
  getCurrentUser: async () => loggedIn ? { id: "user" } : null,
  getFamilyRoleForUserId: async () => role,
  normalizeSafeRedirectPath: (value: string) => value,
});
const pageData = { slug: "unit", title: "Тест", people: [{ id: "active" }], archivedPeople: [], auditLog: [],
  pagination: { previousCursor: null, nextCursor: "next", isFiltered: false } };
stubModule("../lib/family-archive-reader", {
  normalizeArchiveCursor: (query: unknown) => query,
  getFamilyArchivePage: async (...args: unknown[]) => { reads.push(args); return missing ? null : pageData; },
  getFamilyJournalPage: async (...args: unknown[]) => { reads.push(args); return missing ? null : pageData; },
});
stubModule("../lib/family-repository", {
  getFamilyBySlug: async () => { throw new Error("Unoptimized archive reader used"); },
  getFamilyJournalBySlug: async () => { throw new Error("Unoptimized journal reader used"); },
});
stubModule("../components/family-archive", { FamilyArchive: () => null });
stubModule("../components/family-journal", { FamilyJournal: () => null });
stubModule("../components/site-header", { SiteHeader: () => null });
stubModule("next/navigation", {
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
  notFound: () => { throw new Error("not-found"); },
});
const { default: ArchivePage }: typeof import("../app/family/[slug]/archive/page") = requireTest("../app/family/[slug]/archive/page");
const { default: JournalPage }: typeof import("../app/family/[slug]/journal/page") = requireTest("../app/family/[slug]/journal/page");

test("archive page authorizes before its lean cursor read and preserves role-controlled restore", async () => {
  const props = { params: Promise.resolve({ slug: "unit" }), searchParams: Promise.resolve({ after: "cursor" }) };
  reads.length = 0;
  loggedIn = false;
  await assert.rejects(ArchivePage(props), /redirect:\/login/);
  assert.equal(reads.length, 0);
  loggedIn = true; role = null;
  await assert.rejects(ArchivePage(props), /not-found/);
  assert.equal(reads.length, 0);
  for (const viewerRole of ["guest", "member", "editor", "admin", "owner"]) {
    role = viewerRole;
    const rendered = await ArchivePage(props);
    const content = (rendered.props.children as ReactElement<{ canManage: boolean; pagination: unknown }>[])[1];
    assert.equal(content.props.canManage, ["editor", "admin", "owner"].includes(viewerRole));
    assert.deepEqual(reads.at(-1), ["unit", { after: "cursor" }]);
    assert.deepEqual(content.props.pagination, pageData.pagination);
  }
  missing = true;
  await assert.rejects(ArchivePage(props), /not-found/);
  missing = false;
});

test("journal page authorizes before loading its bounded journal-only projection", async () => {
  const props = { params: Promise.resolve({ slug: "unit" }) };
  reads.length = 0; loggedIn = false;
  await assert.rejects(JournalPage(props), /redirect:\/login/);
  assert.equal(reads.length, 0);
  loggedIn = true; role = null;
  await assert.rejects(JournalPage(props), /not-found/);
  assert.equal(reads.length, 0);
  role = "member";
  const rendered = await JournalPage(props);
  assert.deepEqual(reads.at(-1), ["unit"]);
  const content = (rendered.props.children as ReactElement<{ backHref: string }>[])[1];
  assert.equal(content.props.backHref, "/family/unit?person=active");
  missing = true;
  await assert.rejects(JournalPage(props), /not-found/);
  missing = false;
});
