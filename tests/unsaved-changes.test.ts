import test from "node:test";
import assert from "node:assert/strict";
import {
  createHistoryTraversalGuard,
  createUnsavedChangesGuard,
  isLeavingDocumentLink,
} from "@/components/use-unsaved-changes";

const currentUrl = "https://rodovo.test/family/example?focus=person-1#stories";

test("ordinary same-tab links that change the page or selected person need protection", () => {
  for (const href of ["/families", "?focus=person-2", "https://other.test/", "/family/example", ""]) {
    assert.equal(isLeavingDocumentLink({ href }, currentUrl), true, href);
  }
});

test("hash-only navigation retains the current draft", () => {
  for (const href of ["#biography", "#", currentUrl, "?focus=person-1#photos"]) {
    assert.equal(isLeavingDocumentLink({ href }, currentUrl), false, href);
  }
});

test("new tabs, downloads, modified clicks and cancelled clicks do not discard a draft", () => {
  const link = { href: "/families" };
  for (const options of [
    { target: "_blank" }, { target: "preview" }, { download: true },
    { button: 1 }, { button: 2 }, { ctrlKey: true }, { metaKey: true },
    { shiftKey: true }, { altKey: true }, { defaultPrevented: true },
  ]) {
    assert.equal(isLeavingDocumentLink({ ...link, ...options }, currentUrl), false, JSON.stringify(options));
  }
  assert.equal(isLeavingDocumentLink({ ...link, target: "_self" }, currentUrl), true);
  assert.equal(isLeavingDocumentLink({ ...link, target: "_top" }, currentUrl), true);
  assert.equal(isLeavingDocumentLink({ ...link, target: "_parent" }, currentUrl), true);
});

test("non-web and malformed links are not treated as document navigation", () => {
  for (const href of ["mailto:family@example.test", "tel:+1234", "javascript:void(0)", "data:text/plain,hi", "http://["]) {
    assert.equal(isLeavingDocumentLink({ href }, currentUrl), false, href);
  }
});

test("cancelling a discard preserves protection for the next attempt and refresh", () => {
  let confirmations = 0;
  const guard = createUnsavedChangesGuard(true, false, () => { confirmations += 1; return false; });
  assert.equal(guard.confirmDiscard(), false);
  assert.equal(guard.shouldBlockUnload(), true);
  assert.equal(guard.confirmDiscard(), false);
  assert.equal(confirmations, 2);
});

test("accepting a local discard does not disable protection for a different dirty draft", () => {
  let confirmations = 0;
  const guard = createUnsavedChangesGuard(true, false, () => { confirmations += 1; return true; });
  assert.equal(guard.confirmDiscard(), true);
  assert.equal(guard.confirmDiscard(), true);
  assert.equal(confirmations, 2);
});

test("an approved departure can bypass a duplicate prompt until another user interaction", () => {
  let confirmations = 0;
  const guard = createUnsavedChangesGuard(true, false, () => { confirmations += 1; return true; });
  assert.equal(guard.confirmDiscard(), true);
  guard.bypass();
  assert.equal(guard.shouldBlockUnload(), false);
  assert.equal(guard.confirmDiscard(), true);
  assert.equal(confirmations, 1);
  guard.resume();
  assert.equal(guard.shouldBlockUnload(), true);
  assert.equal(guard.confirmDiscard(), true);
  assert.equal(confirmations, 2);
});

test("saving and opening a new draft resets the previous bypass", () => {
  const guard = createUnsavedChangesGuard(true, false, () => false);
  guard.bypass();
  guard.update(false, false);
  assert.equal(guard.confirmDiscard(), true);
  assert.equal(guard.shouldBlockUnload(), false);
  guard.update(true, false);
  assert.equal(guard.confirmDiscard(), false);
  assert.equal(guard.shouldBlockUnload(), true);
});

test("pending work blocks local transitions and protects page unload", () => {
  let confirmations = 0;
  const guard = createUnsavedChangesGuard(false, true, () => { confirmations += 1; return true; });
  assert.equal(guard.confirmDiscard(), false);
  assert.equal(guard.shouldBlockUnload(), true);
  assert.equal(confirmations, 0);
  guard.update(true, false);
  assert.equal(guard.confirmDiscard(), true);
  assert.equal(confirmations, 1);
});

test("unavailable confirmation fails closed and keeps the draft protected", () => {
  const guard = createUnsavedChangesGuard(true, false, () => { throw new Error("Confirmation unavailable"); });
  assert.equal(guard.confirmDiscard(), false);
  assert.equal(guard.shouldBlockUnload(), true);
});

test("cancelled Back stops the router first and restores the opaque current history entry", () => {
  const originalState = { __NA: true, tree: ["opaque", { cache: "retain" }] };
  let current = { url: currentUrl, state: originalState as unknown };
  const calls: string[] = [];
  const guard = createUnsavedChangesGuard(true, false, () => false);
  const historyGuard = createHistoryTraversalGuard(guard, () => current, (snapshot) => {
    calls.push("restore");
    current = snapshot;
  });
  current = { url: "https://rodovo.test/families", state: { previousPage: true } };
  historyGuard.onPopState({ stopImmediatePropagation: () => calls.push("stop") });
  assert.deepEqual(calls, ["stop", "restore"]);
  assert.equal(current.url, currentUrl);
  assert.equal(current.state, originalState, "the router's opaque state must not be rebuilt or altered");
  assert.equal(guard.shouldBlockUnload(), true);
});

test("accepted Back lets the router run and bypasses the upcoming focus-change confirmation", () => {
  let current = { url: currentUrl, state: null };
  let confirmations = 0;
  const guard = createUnsavedChangesGuard(true, false, () => { confirmations += 1; return true; });
  const historyGuard = createHistoryTraversalGuard(guard, () => current, () => assert.fail("Must not restore accepted navigation"));
  current = { url: "https://rodovo.test/family/example?focus=person-2", state: null };
  historyGuard.onPopState({ stopImmediatePropagation: () => assert.fail("Must allow the router listener") });
  assert.equal(guard.confirmDiscard(), true);
  assert.equal(guard.shouldBlockUnload(), false);
  assert.equal(confirmations, 1);
});

test("hash traversal including removing the hash does not discard the draft", () => {
  let current = { url: currentUrl, state: null };
  const guard = createUnsavedChangesGuard(true, false, () => assert.fail("Hash traversal retains the form"));
  const historyGuard = createHistoryTraversalGuard(guard, () => current, () => assert.fail("Hash traversal must stay native"));
  for (const url of [currentUrl.replace("#stories", "#biography"), currentUrl.replace("#stories", "")]) {
    current = { url, state: null };
    historyGuard.onPopState({ stopImmediatePropagation: () => assert.fail("Hash traversal must reach the router") });
  }
  assert.equal(guard.shouldBlockUnload(), true);
});

test("a new interaction captures the current route before a later cancelled Forward", () => {
  let current = { url: currentUrl, state: { revision: 1 } as unknown };
  const guard = createUnsavedChangesGuard(true, false, () => false);
  const historyGuard = createHistoryTraversalGuard(guard, () => current, (snapshot) => { current = snapshot; });
  const latest = { url: "https://rodovo.test/family/example?focus=person-2", state: { revision: 2 } };
  current = latest;
  historyGuard.rememberCurrent();
  current = { url: "https://rodovo.test/families", state: null };
  historyGuard.onPopState({ stopImmediatePropagation() {} });
  assert.equal(current.url, latest.url);
  assert.equal(current.state, latest.state);
});

test("busy traversal is cancelled while a clean traversal is allowed without prompting", () => {
  let current: { url: string; state: unknown } = { url: currentUrl, state: null };
  let stopped = 0;
  const guard = createUnsavedChangesGuard(false, true, () => assert.fail("Busy and clean states do not ask"));
  const historyGuard = createHistoryTraversalGuard(guard, () => current, (snapshot) => { current = snapshot; });
  current = { url: "https://rodovo.test/families", state: null };
  historyGuard.onPopState({ stopImmediatePropagation() { stopped += 1; } });
  assert.equal(current.url, currentUrl);
  assert.equal(stopped, 1);
  guard.update(false, false);
  current = { url: "https://rodovo.test/families", state: null };
  historyGuard.onPopState({ stopImmediatePropagation() { stopped += 1; } });
  assert.equal(current.url, "https://rodovo.test/families");
  assert.equal(stopped, 1);
});
