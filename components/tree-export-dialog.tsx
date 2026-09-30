"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Family } from "@/lib/types";
import { getPersonFullName, type FamilyTreeLayout } from "@/lib/family-utils";
import { buildFamilyTreeExport, type TreeExportStyle } from "@/lib/family-tree-export";
import { downloadTreeExport, type TreeExportFormat } from "@/lib/tree-export-download";

type TreeExportDialogProps = {
  family: Family;
  layout: FamilyTreeLayout;
  open: boolean;
  onClose: () => void;
};

const EXPORT_STYLE_COPY: Record<TreeExportStyle, { description: string; alt: string }> = {
  tree: { description: "Самые старшие известные предки — внизу, у корней. Их потомки — выше, на ветвях.", alt: "Предпросмотр семейного дерева с декоративными ветвями" },
  circle: { description: "Круги и связи, включая ваше ручное расположение.", alt: "Предпросмотр круговой схемы с текущим расположением людей" },
  pyramid: { description: "Старшие предки — наверху пирамиды. Дети и следующие поколения — ниже, по ярусам.", alt: "Предпросмотр семейной пирамиды: старшие предки сверху, потомки ниже" },
};

export function TreeExportDialog({ family, layout, open, onClose }: TreeExportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  const request = useRef(0);
  const activeDownload = useRef<AbortController | null>(null);
  const canvasPersonId = layout.nodes.find((node) => node.isFocus)?.person.id;
  const defaultPersonId = family.people.find((person) => person.id === canvasPersonId)?.id ?? family.people[0]?.id ?? "";
  const defaultPersonRef = useRef(defaultPersonId);
  defaultPersonRef.current = defaultPersonId;
  const [style, setStyle] = useState<TreeExportStyle>("tree");
  const [exportPersonId, setExportPersonId] = useState(defaultPersonId);
  const selectedExportPersonId = family.people.some((person) => person.id === exportPersonId) ? exportPersonId : defaultPersonId;
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<TreeExportFormat | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const titleId = useId();
  const descriptionId = useId();
  const styleId = useId();
  const personId = useId();
  const personHelpId = useId();
  const hasPeople = style === "circle" ? layout.nodes.length > 0 : family.people.length > 0;
  const artwork = useMemo(() => {
    if (!open || !hasPeople) return null;
    try { return buildFamilyTreeExport(family, layout, style, selectedExportPersonId); }
    catch { return null; }
  }, [family, layout, open, style, selectedExportPersonId, hasPeople]);
  const peopleCount = artwork?.peopleCount ?? layout.nodes.length;

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousPadding = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + scrollbarWidth}px`;
    document.body.style.overflow = "hidden";
    setError("");
    setStatus("");
    setBusy(null);
    setStyle("tree");
    setExportPersonId(defaultPersonRef.current);
    dialog.showModal();
    dialog.querySelector<HTMLSelectElement>("select")?.focus({ preventScroll: true });
    return () => {
      request.current += 1;
      activeDownload.current?.abort();
      activeDownload.current = null;
      dialog.close();
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPadding;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    setPreviewUrl(null);
    if (!artwork) return;
    const url = URL.createObjectURL(new Blob([artwork.svg], { type: "image/svg+xml;charset=utf-8" }));
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [artwork]);

  async function download(format: TreeExportFormat) {
    if (!artwork || busy || activeDownload.current) return;
    const currentRequest = ++request.current;
    const controller = new AbortController();
    activeDownload.current = controller;
    setBusy(format);
    setError("");
    setStatus(`Готовим ${format.toUpperCase()}…`);
    try {
      await downloadTreeExport(artwork, family.title, style, format, controller.signal);
      if (currentRequest === request.current) setStatus(`${format.toUpperCase()} готов. Файл передан в загрузки браузера.`);
    } catch (cause) {
      if (currentRequest === request.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Не удалось скачать файл. Попробуйте ещё раз.");
        setStatus("");
      }
    } finally {
      if (currentRequest === request.current) {
        activeDownload.current = null;
        setBusy(null);
      }
    }
  }

  function isOutside(clientX: number, clientY: number) {
    const bounds = dialogRef.current?.getBoundingClientRect();
    return Boolean(bounds && (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom));
  }

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className="tree-export-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-modal="true"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
        if (event.key !== "Tab") return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("button, select, a[href], [tabindex]")]
          .filter((element) => !element.matches(":disabled") && element.tabIndex >= 0 && element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first || !last) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
      onPointerDown={(event) => { backdropPress.current = event.target === event.currentTarget && isOutside(event.clientX, event.clientY); }}
      onClick={(event) => {
        if (backdropPress.current && event.target === event.currentTarget && isOutside(event.clientX, event.clientY)) onClose();
        backdropPress.current = false;
      }}
    >
      <header className="tree-export-header">
        <div>
          <p className="eyebrow">Семейная реликвия</p>
          <h2 id={titleId}>Сохранить семейное дерево</h2>
          <p id={descriptionId}>Красивый постер для печати и семейного архива.</p>
        </div>
        <button type="button" className="tree-export-close" aria-label="Закрыть экспорт дерева" onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className="tree-export-body">
        <div className="tree-export-preview">
          {previewUrl ? (
            // The generated local SVG must stay an image, never executable DOM.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={EXPORT_STYLE_COPY[style].alt} />
          ) : <p>{!hasPeople ? "В этом виде дерева нет людей." : artwork ? "Готовим предпросмотр…" : "Не удалось подготовить предпросмотр."}</p>}
        </div>
        <div className="tree-export-settings">
          <div className="tree-export-style">
            <label htmlFor={styleId}>Оформление</label>
            <select id={styleId} value={style} disabled={Boolean(busy)} onChange={(event) => { setStyle(event.target.value as TreeExportStyle); setError(""); setStatus(""); }}>
              <option value="tree">Живое дерево</option>
              <option value="circle">Круговая схема</option>
              <option value="pyramid">Пирамида</option>
            </select>
            <p>{EXPORT_STYLE_COPY[style].description}</p>
          </div>
          {style !== "circle" ? <div className="tree-export-style">
            <label htmlFor={personId}>Относительно кого</label>
            <select id={personId} aria-describedby={personHelpId} value={selectedExportPersonId} disabled={Boolean(busy) || !family.people.length} onChange={(event) => { setExportPersonId(event.target.value); setError(""); setStatus(""); }}>
              {!family.people.length ? <option value="">В семье пока нет людей</option> : family.people.map((person) => <option key={person.id} value={person.id}>{getPersonFullName(person)}</option>)}
            </select>
            <p id={personHelpId}>Выбор относится только к экспорту и не меняет выбранного человека на экране.</p>
          </div> : null}
          <div className="tree-export-scope">
            <strong>Людей в экспорте: {peopleCount}</strong>
            <p>{style === "circle" ? "Сохраняются люди и связи из текущего вида дерева. Скрытые люди не попадут в файл." : "Ветвь строится по записанным связям: предки по обеим линиям, их потомки и супруги потомков. Фильтр на экране не ограничивает ветвь."}</p>
          </div>
          <div className="tree-export-actions" aria-busy={Boolean(busy)}>
            <button className="tree-export-download tree-export-download-primary" type="button" disabled={!artwork || Boolean(busy)} onClick={() => void download("png")}>
              {busy === "png" ? "Готовим PNG…" : "Скачать PNG"}
            </button>
            <button className="tree-export-download" type="button" disabled={!artwork || Boolean(busy)} onClick={() => void download("pdf")}>
              {busy === "pdf" ? "Готовим PDF…" : "Скачать PDF"}
            </button>
          </div>
          <p className="tree-export-format-note">PNG — изображение высокого разрешения. PDF — один лист, удобно печатать.</p>
          <p className="tree-export-status" role="status" aria-live="polite">{status}</p>
          {error ? <p className="tree-export-error" role="alert">{error}</p> : null}
          <p className="tree-export-privacy">Файл создаётся только в вашем браузере. Данные семьи не отправляются во внешние сервисы.</p>
        </div>
      </div>
    </dialog>
  );
}
