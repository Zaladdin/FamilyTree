"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

type PersonFormDialogProps = {
  title: string;
  description: string;
  busy?: boolean;
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
};

export function PersonFormDialog({ title, description, busy = false, closeLabel = "Закрыть форму добавления человека", onClose, children }: PersonFormDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousPadding = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + scrollbarWidth}px`;
    }
    document.body.style.overflow = "hidden";
    // Native modal top layer keeps the form above the canvas and makes the
    // background inert, without inserting a large form into the tree layout.
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });

    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPadding;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  function isOutside(clientX: number, clientY: number) {
    const bounds = dialogRef.current?.getBoundingClientRect();
    return Boolean(bounds && (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom));
  }

  return (
    <dialog
      ref={dialogRef}
      className="person-form-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-modal="true"
      aria-busy={busy}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const dialog = event.currentTarget;
        const controls = [...dialog.querySelectorAll<HTMLElement>("button, input, select, textarea, summary, a[href], [tabindex]")]
          .filter((element) => !element.matches(":disabled") && element.tabIndex >= 0 && element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first || !last) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }}
      onPointerDown={(event) => { backdropPress.current = event.target === event.currentTarget && isOutside(event.clientX, event.clientY); }}
      onClick={(event) => {
        if (backdropPress.current && event.target === event.currentTarget && isOutside(event.clientX, event.clientY) && !busy) onClose();
        backdropPress.current = false;
      }}
    >
      <div className="person-form-dialog__header">
        <div>
          <h2 id={titleId}>{title}</h2>
          <p id={descriptionId}>{description}</p>
        </div>
        <button className="person-form-dialog__close" type="button" aria-label={closeLabel} disabled={busy} onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {children}
    </dialog>
  );
}
