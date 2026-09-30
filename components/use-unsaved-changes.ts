"use client";

import { useEffect, useLayoutEffect, useState } from "react";

type NavigationLink = {
  href: string;
  target?: string;
  download?: boolean;
  button?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
};

export function isLeavingDocumentLink(link: NavigationLink, currentUrl: string) {
  if (link.defaultPrevented || (link.button ?? 0) !== 0 || link.download
    || link.ctrlKey || link.metaKey || link.shiftKey || link.altKey) return false;
  if (link.target && !["_self", "_top", "_parent"].includes(link.target.toLowerCase())) return false;

  try {
    const current = new URL(currentUrl);
    const destination = new URL(link.href, current);
    if (!["http:", "https:"].includes(destination.protocol)) return false;
    const sameDocument = destination.origin === current.origin
      && destination.pathname === current.pathname && destination.search === current.search;
    return !(sameDocument && link.href.includes("#"));
  } catch {
    return false;
  }
}

export function createUnsavedChangesGuard(
  dirty: boolean,
  busy: boolean,
  confirm: () => boolean,
) {
  let bypassed = false;

  return {
    update(nextDirty: boolean, nextBusy: boolean) {
      dirty = nextDirty;
      busy = nextBusy;
      if (!dirty && !busy) bypassed = false;
    },
    confirmDiscard() {
      if (bypassed) return true;
      if (busy) return false;
      if (!dirty) return true;
      try {
        return confirm();
      } catch {
        // A blocked or unavailable confirmation must never imply permission.
        return false;
      }
    },
    shouldBlockUnload: () => !bypassed && (dirty || busy),
    bypass() { bypassed = true; },
    resume() { bypassed = false; },
  };
}

type HistorySnapshot = { url: string; state: unknown };

export function createHistoryTraversalGuard(
  guard: Pick<ReturnType<typeof createUnsavedChangesGuard>, "confirmDiscard" | "bypass">,
  readCurrent: () => HistorySnapshot,
  restore: (snapshot: HistorySnapshot) => void,
) {
  let saved = readCurrent();

  return {
    rememberCurrent() { saved = readCurrent(); },
    onPopState(event: Pick<PopStateEvent, "stopImmediatePropagation">) {
      const destination = readCurrent();
      const previousUrl = new URL(saved.url);
      const nextUrl = new URL(destination.url);
      const sameRoute = previousUrl.origin === nextUrl.origin
        && previousUrl.pathname === nextUrl.pathname && previousUrl.search === nextUrl.search;
      if (sameRoute) {
        saved = destination;
        return;
      }
      if (guard.confirmDiscard()) {
        saved = destination;
        // The ensuing route/focus update is part of the approved departure.
        guard.bypass();
        return;
      }
      // Prevent Next's popstate listener from unmounting the current draft.
      event.stopImmediatePropagation();
      // Restoring with pushState keeps the current DOM and opaque router state.
      // Cancelling Forward can truncate the forward branch; preserving the
      // unsaved draft takes priority over retaining that branch of history.
      restore(saved);
    },
  };
}

export function useUnsavedChanges(dirty: boolean, busy = false): {
  confirmDiscard: () => boolean;
  bypass: () => void;
} {
  const [guard] = useState(() => createUnsavedChangesGuard(
    dirty,
    busy,
    () => window.confirm("Есть несохранённые изменения. Выйти без сохранения?"),
  ));

  useLayoutEffect(() => {
    guard.update(dirty, busy);
  }, [guard, dirty, busy]);

  useEffect(() => {
    if (!dirty && !busy) return;

    const historyGuard = createHistoryTraversalGuard(
      guard,
      () => ({ url: window.location.href, state: window.history.state }),
      ({ url, state }) => window.history.pushState(state, "", url),
    );

    function beforeUnload(event: BeforeUnloadEvent) {
      if (!guard.shouldBlockUnload()) return;
      event.preventDefault();
      event.returnValue = "";
    }

    function captureNavigation(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || !isLeavingDocumentLink({
        href: anchor.href,
        target: anchor.target || document.querySelector("base[target]")?.getAttribute("target") || "",
        download: anchor.hasAttribute("download"),
        button: event.button,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        defaultPrevented: event.defaultPrevented,
      }, window.location.href)) return;

      if (guard.confirmDiscard()) {
        // The native page departure must not ask again after this confirmation.
        guard.bypass();
        return;
      }
      event.preventDefault();
      // Capture runs before React/Next's delegated link navigation handlers.
      event.stopImmediatePropagation();
    }

    // If navigation was cancelled downstream or failed, the next interaction
    // restores protection instead of leaving a still-open draft unprotected.
    function resumeProtection() {
      guard.resume();
      historyGuard.rememberCurrent();
    }

    document.addEventListener("pointerdown", resumeProtection, true);
    document.addEventListener("keydown", resumeProtection, true);
    document.addEventListener("input", resumeProtection, true);
    document.addEventListener("click", captureNavigation, true);
    // Window capture precedes Next's ordinary window popstate listener.
    window.addEventListener("popstate", historyGuard.onPopState, true);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      document.removeEventListener("pointerdown", resumeProtection, true);
      document.removeEventListener("keydown", resumeProtection, true);
      document.removeEventListener("input", resumeProtection, true);
      document.removeEventListener("click", captureNavigation, true);
      window.removeEventListener("popstate", historyGuard.onPopState, true);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [guard, dirty, busy]);

  return { confirmDiscard: guard.confirmDiscard, bypass: guard.bypass };
}
