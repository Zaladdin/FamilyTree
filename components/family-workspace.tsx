"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  getPersonFullName,
} from "@/lib/family-utils";
import Link from "next/link";
import Image from "next/image";
import { fitTreeViewport, focusTreeViewport, minimapScenePoint, TREE_MIN_SCALE, zoomAroundCenter } from "@/lib/tree-viewport";
import { countNoun } from "@/lib/count-label";
import { buildFamilyDisplayLayout, type FamilyDisplayMode } from "@/lib/family-display-layout";
import { constrainNodeOffset, repositionFamilyLayout, screenDragOffset, type NodeOffset, type NodeOffsets } from "@/lib/family-node-positions";
import { TreeExportDialog } from "@/components/tree-export-dialog";
import { PersonStories } from "@/components/person-stories";
import { getFamilyKinship } from "@/lib/family-kinship";
import { Family, FamilyPerson, MediaAsset, Story } from "@/lib/types";
import {
  BookGlyph,
  ExpandGlyph,
  GroupGlyph,
  PersonGlyph,
  TreeGlyph,
  ZoomInGlyph,
  ZoomOutGlyph,
} from "@/components/workspace-glyphs";

type FamilyWorkspaceProps = {
  family: Family;
  focusPersonId: string | null;
  canEdit: boolean;
  canvasScale: number;
  onFocusPerson?: (personId: string | null) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetZoom?: () => void;
  onScaleChange?: (nextScale: number) => void;
  onOpenAddPerson?: () => void;
  onOpenAddRelationship?: () => void;
  onOpenEditPerson?: () => void;
  onOpenUploadMedia?: () => void;
  onOpenCreateStory?: () => void;
  onEditStory?: (story: Story) => void;
  onDeleteStory?: (story: Story) => void;
  onRestoreStory?: (story: Story) => void;
  storyFocusRevision?: number;
  onDeleteMedia?: (asset: MediaAsset) => void;
  onArchivePerson?: () => void;
  addPersonSheet?: ReactNode;
  feedbackMessage?: string;
  demo?: boolean;
};

type TreeNodeProps = {
  person: FamilyPerson;
  role: string;
  isFocus: boolean;
  isContext?: boolean;
  size: number;
  relationPath?: string;
  onSelect?: (personId: string) => void;
  onMove?: (personId: string, delta: NodeOffset) => void;
};

type PointerState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  personId: string | null;
  scope: string;
  scale: number;
  moved: boolean;
};

const DRAG_THRESHOLD = 6;

function getInitials(person: FamilyPerson) {
  return `${person.firstName.charAt(0)}${person.lastName.charAt(0)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function TreeNode({ person, role, isFocus, isContext = false, size, relationPath, onSelect, onMove }: TreeNodeProps) {
  const photo = person.mediaAssets.find((asset) => asset.type === "photo");
  return (
    <button
      className={`gene-node gene-node-round small interactive${isFocus ? " is-focus" : ""}${isContext ? " is-context" : ""}`}
      data-person-id={person.id}
      style={{
        width: size,
        height: size,
      }}
      aria-label={`${getPersonFullName(person)}${role ? `, ${role.toLowerCase()}` : ""}`}
      title={`${getPersonFullName(person)}${role ? ` — ${role}` : ""}${relationPath ? `\nСвязь: ${relationPath}` : ""}`}
      aria-pressed={isFocus}
      aria-describedby="tree-move-help"
      aria-keyshortcuts="Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight"
      onKeyDown={(event) => {
        if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
        const moves: Record<string, NodeOffset> = { ArrowUp: { x: 0, y: -12 }, ArrowDown: { x: 0, y: 12 }, ArrowLeft: { x: -12, y: 0 }, ArrowRight: { x: 12, y: 0 } };
        if (!Object.hasOwn(moves, event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        onMove?.(person.id, moves[event.key]);
      }}
      onClick={(event) => {
        // Pointer taps are selected by the pan surface; keyboard activation has no pointer event.
        if (event.detail === 0) onSelect?.(person.id);
      }}
      type="button"
    >
      <div className="gene-node-badge" aria-hidden="true">
        {photo ? <Image alt="" src={photo.url} width={56} height={56} unoptimized /> : getInitials(person)}
      </div>
      <div className="gene-node-copy">
        <strong>{person.firstName}</strong>
        <span>{person.lastName}</span>
        <small>{person.birthDate || "Дата не указана"}{person.deathDate ? ` — ${person.deathDate}` : ""}</small>
        {isFocus || role ? <small className="gene-node-role">{isFocus ? "Выбранный человек" : role}</small> : null}
      </div>
    </button>
  );
}

export function FamilyWorkspace({
  family,
  focusPersonId,
  canEdit,
  canvasScale,
  onFocusPerson,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onScaleChange,
  onOpenAddPerson,
  onOpenAddRelationship,
  onOpenEditPerson,
  onOpenUploadMedia,
  onOpenCreateStory,
  onEditStory,
  onDeleteStory,
  onRestoreStory,
  storyFocusRevision,
  onDeleteMedia,
  onArchivePerson,
  addPersonSheet,
  feedbackMessage,
  demo = false,
}: FamilyWorkspaceProps) {
  const [search, setSearch] = useState("");
  const [hideOthers, setHideOthers] = useState(false);
  const [displayMode, setDisplayMode] = useState<FamilyDisplayMode>("radial");
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });
  const [positionViews, setPositionViews] = useState<Record<string, NodeOffsets>>({});
  const [positionReset, setPositionReset] = useState(0);
  const [moveMessage, setMoveMessage] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const pointerStateRef = useRef<PointerState | null>(null);
  const panSurfaceRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const centeredFocusRef = useRef<string | null>(null);
  const previousDisplayModeRef = useRef(displayMode);
  const previousScaleRef = useRef(canvasScale);
  const pendingFitScaleRef = useRef<number | null>(null);
  const focusPerson = family.people.find((person) => person.id === focusPersonId);
  const hasPeople = family.people.length > 0;
  const activeMode = focusPerson && hideOthers ? "close" : "all";
  const kinship = useMemo(() => getFamilyKinship(family, focusPerson?.id ?? ""), [family, focusPerson?.id]);
  const peopleById = useMemo(() => new Map(family.people.map((person) => [person.id, person])), [family.people]);
  const relativeBadges = useMemo(() => family.people.flatMap((person) => {
    const relation = kinship.get(person.id);
    return relation ? [{ role: relation.label, person, distance: relation.distance }] : [];
  }).sort((a, b) => a.distance - b.distance || getPersonFullName(a.person).localeCompare(getPersonFullName(b.person), "ru")), [family.people, kinship]);

  function relationPath(personId: string) {
    return kinship.get(personId)?.pathIds.map((id) => peopleById.get(id)).filter((person): person is FamilyPerson => Boolean(person)).map(getPersonFullName).join(" → ");
  }

  const automaticLayout = useMemo(
    () => buildFamilyDisplayLayout(family, focusPerson?.id ?? null, activeMode === "close", kinship, displayMode),
    [family, focusPerson?.id, activeMode, kinship, displayMode],
  );
  const branchKey = `${displayMode}:${activeMode}:${focusPerson?.id ?? "overview"}`;
  const positionScope = JSON.stringify([family.id, displayMode, activeMode, displayMode === "pyramid" && activeMode === "all" ? null : focusPerson?.id ?? null]);
  const offsets = positionViews[positionScope];
  const layout = useMemo(() => repositionFamilyLayout(automaticLayout, offsets ?? {}, family.relationships), [automaticLayout, offsets, family.relationships]);
  // Circle export always uses its own remembered positions, even from pyramid view.
  const exportCircleLayout = useMemo(() => {
    if (!exportOpen || displayMode === "radial") return layout;
    const radial = buildFamilyDisplayLayout(family, focusPerson?.id ?? null, activeMode === "close", kinship);
    const radialScope = JSON.stringify([family.id, "radial", activeMode, focusPerson?.id ?? null]);
    return repositionFamilyLayout(radial, positionViews[radialScope] ?? {}, family.relationships);
  }, [exportOpen, displayMode, layout, family, focusPerson?.id, activeMode, kinship, positionViews]);
  // Automatic centring tracks the perspective, not manual node movement.
  const focusNode = automaticLayout.nodes.find((node) => node.isFocus);
  const hasManualPositions = Boolean(offsets && Object.values(offsets).some((offset) => offset.x || offset.y));

  const diagramWidth = Math.max(layout.width, 1);
  const diagramHeight = Math.max(layout.height, 1);
  const matchedPeople = family.people.filter((person) =>
    getPersonFullName(person).toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru")),
  );

  function selectPerson(personId: string) {
    if (search.trim()) searchInputRef.current?.focus({ preventScroll: true });
    setSearch("");
    if (personId === focusPerson?.id) handleFocusView();
    onFocusPerson?.(personId);
  }

  function clearSelection() {
    setSearch("");
    setHideOthers(false);
    onFocusPerson?.(null);
    searchInputRef.current?.focus({ preventScroll: true });
  }

  function centerOnFocus(scale: number) {
    if (!surfaceSize.width || !surfaceSize.height) {
      return;
    }

    const focusNode = layout.nodes.find((node) => node.isFocus);

    if (!focusNode) {
      setPanOffset({
        x: (surfaceSize.width - diagramWidth * scale) / 2,
        y: (surfaceSize.height - diagramHeight * scale) / 2,
      });
      return;
    }

    setPanOffset({
      x: surfaceSize.width / 2 - focusNode.x * scale,
      y: surfaceSize.height / 2 - focusNode.y * scale,
    });
  }

  useEffect(() => {
    if (!surfaceSize.width || !surfaceSize.height) {
      return;
    }

    // Selecting a person zooms back into their card, instead of fitting the whole family.
    const fitKey = `${family.id}:${branchKey}:${positionReset}:${surfaceSize.width}:${surfaceSize.height}:${layout.width}:${layout.height}:${layout.nodes.length}:${focusNode?.x}:${focusNode?.y}`;
    if (centeredFocusRef.current === fitKey) {
      return;
    }

    centeredFocusRef.current = fitKey;
    const modeChanged = previousDisplayModeRef.current !== displayMode;
    previousDisplayModeRef.current = displayMode;
    if (modeChanged) handleResetView();
    else if (focusPerson) handleFocusView();
    else handleResetView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family.id, branchKey, displayMode, positionReset, surfaceSize.width, surfaceSize.height, layout.width, layout.height, layout.nodes.length, focusNode?.x, focusNode?.y]);

  // Keep the centre of the viewport stable when zoom buttons change the scale.
  useEffect(() => {
    const previousScale = previousScaleRef.current;
    previousScaleRef.current = canvasScale;
    if (pendingFitScaleRef.current !== null) {
      if (pendingFitScaleRef.current === canvasScale) pendingFitScaleRef.current = null;
      return;
    }
    if (previousScale === canvasScale || !surfaceSize.width) return;
    setPanOffset((current) => zoomAroundCenter(current, { width: surfaceSize.width, height: surfaceSize.height }, previousScale, canvasScale));
  }, [canvasScale, surfaceSize.width, surfaceSize.height]);

  useEffect(() => {
    const element = panSurfaceRef.current;

    if (!element) {
      return undefined;
    }

    function syncSurfaceSize() {
      const currentElement = panSurfaceRef.current;

      if (!currentElement) {
        return;
      }

      setSurfaceSize({
        width: currentElement.clientWidth,
        height: currentElement.clientHeight,
      });
    }

    syncSurfaceSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncSurfaceSize);
      return () => window.removeEventListener("resize", syncSurfaceSize);
    }

    const observer = new ResizeObserver(syncSurfaceSize);
    observer.observe(element);

    return () => observer.disconnect();
  }, [hasPeople]);

  const minimapWidth = 176;
  const minimapHeight = Math.max(
    (diagramHeight / diagramWidth) * minimapWidth,
    1,
  );
  const viewportX = clamp(-panOffset.x / canvasScale, 0, diagramWidth);
  const viewportY = clamp(-panOffset.y / canvasScale, 0, diagramHeight);
  const viewportWidth = Math.max(0, clamp((surfaceSize.width - panOffset.x) / canvasScale, 0, diagramWidth) - viewportX);
  const viewportHeight = Math.max(0, clamp((surfaceSize.height - panOffset.y) / canvasScale, 0, diagramHeight) - viewportY);

  const minimapViewport = {
    x: (viewportX / diagramWidth) * minimapWidth,
    y: (viewportY / diagramHeight) * minimapHeight,
    width: (viewportWidth / diagramWidth) * minimapWidth,
    height: (viewportHeight / diagramHeight) * minimapHeight,
  };

  function handleCanvasPointerDown(event: PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;

    // Let genuine controls (links, form fields, audio, the minimap) work as-is.
    // A node drag changes its position; empty background pans the whole view.
    if (event.button !== 0 || !event.isPrimary || pointerStateRef.current || target.closest("a, input, textarea, select, audio, .tree-minimap")) {
      return;
    }

    const nodeElement = target.closest("[data-person-id]") as HTMLElement | null;
    const nodeId = nodeElement?.dataset.personId;
    const baseNode = automaticLayout.nodes.find((node) => node.person.id === nodeId);
    const currentNode = layout.nodes.find((node) => node.person.id === nodeId);

    pointerStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: currentNode && baseNode ? currentNode.x - baseNode.x : panOffset.x,
      originY: currentNode && baseNode ? currentNode.y - baseNode.y : panOffset.y,
      personId: currentNode?.person.id ?? null,
      scope: positionScope,
      scale: canvasScale,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCanvasPointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = pointerStateRef.current;

    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;

    if (!state.moved && Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD) {
      state.moved = true;
      setIsDragging(true);
    }

    if (state.moved) {
      if (state.personId) {
        if (state.scope !== positionScope) return;
        setNodeOffset(state.personId, screenDragOffset({ x: state.originX, y: state.originY }, { x: deltaX, y: deltaY }, state.scale));
      } else {
        setPanOffset({ x: state.originX + deltaX, y: state.originY + deltaY });
      }
    }
  }

  function releasePointer(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleCanvasPointerUp(event: PointerEvent<HTMLDivElement>) {
    const state = pointerStateRef.current;

    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    pointerStateRef.current = null;
    setIsDragging(false);
    releasePointer(event);

    // A tap (no meaningful movement) on a node selects that person.
    if (!state.moved && state.personId && state.scope === positionScope) {
      selectPerson(state.personId);
    } else if (state.moved && state.personId) {
      setMoveMessage("Круг перемещён. Расположение сохраняется до перезагрузки страницы.");
    }
  }

  function handleCanvasPointerCancel(event: PointerEvent<HTMLDivElement>) {
    const state = pointerStateRef.current;

    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    pointerStateRef.current = null;
    setIsDragging(false);
    releasePointer(event);
    if (state.moved && state.personId && state.scope === positionScope) {
      setNodeOffset(state.personId, { x: state.originX, y: state.originY });
    } else if (state.moved && !state.personId) {
      setPanOffset({ x: state.originX, y: state.originY });
    }
  }

  function setNodeOffset(personId: string, candidate: NodeOffset) {
    const node = automaticLayout.nodes.find((item) => item.person.id === personId);
    if (!node) return;
    const offset = constrainNodeOffset(node, automaticLayout, candidate);
    setPositionViews((current) => ({ ...current, [positionScope]: { ...current[positionScope], [personId]: offset } }));
  }

  function moveNodeWithKeyboard(personId: string, delta: NodeOffset) {
    const base = automaticLayout.nodes.find((node) => node.person.id === personId);
    const current = layout.nodes.find((node) => node.person.id === personId);
    if (!base || !current) return;
    setNodeOffset(personId, { x: current.x - base.x + delta.x, y: current.y - base.y + delta.y });
    setMoveMessage(`${getPersonFullName(current.person)}: положение изменено. Shift + стрелки — перемещение.`);
  }

  function resetNodePositions() {
    setPositionViews((current) => ({ ...current, [positionScope]: {} }));
    setPositionReset((current) => current + 1);
    setMoveMessage("Исходное расположение восстановлено.");
  }

  function handleFocusView() {
    if (!focusPerson || !surfaceSize.width || !surfaceSize.height) return;
    if (!onScaleChange) {
      onResetZoom?.();
      centerOnFocus(1);
      return;
    }
    const focused = focusTreeViewport(surfaceSize, layout, focusPerson.id);
    // A fit already writes an offset at its target scale. If resize and scale
    // effects share a render, do not apply a second zoom to this fitted offset.
    previousScaleRef.current = focused.scale;
    pendingFitScaleRef.current = focused.scale === canvasScale ? null : focused.scale;
    onScaleChange(focused.scale);
    setPanOffset({ x: focused.x, y: focused.y });
  }

  function handleResetView() {
    if (!surfaceSize.width || !surfaceSize.height) return;
    if (!onScaleChange) {
      onResetZoom?.();
      centerOnFocus(1);
      return;
    }
    const fitted = fitTreeViewport(surfaceSize, layout);
    previousScaleRef.current = fitted.scale;
    pendingFitScaleRef.current = fitted.scale === canvasScale ? null : fitted.scale;
    onScaleChange(fitted.scale);
    setPanOffset({ x: fitted.x, y: fitted.y });
  }

  function handleMinimapNavigate(event: MouseEvent<HTMLButtonElement>) {
    if (event.detail === 0) {
      centerOnFocus(canvasScale);
      return;
    }
    const rect = event.currentTarget.querySelector("svg")?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    const target = minimapScenePoint({ x: event.clientX, y: event.clientY }, rect, { width: diagramWidth, height: diagramHeight });

    setPanOffset({
      x: -(target.x * canvasScale - surfaceSize.width / 2),
      y: -(target.y * canvasScale - surfaceSize.height / 2),
    });
  }

  if (!hasPeople) {
    return (
      <section className="workspace-layout tree-mode">
        <div className="tree-board" style={{ padding: "48px 32px" }}>
          <div className="archive-empty">
            <div className="eyebrow">Пустое дерево</div>
            <h2>В этой семье пока нет людей</h2>
            <p>Добавьте первого человека — с него начнётся ваше семейное дерево.</p>
            {canEdit ? (
              <button className="primary-button" onClick={onOpenAddPerson} type="button">
                Добавить первого человека
              </button>
            ) : (
              <div className="note-box">Режим просмотра. Пока в дереве нет людей.</div>
            )}
          </div>
          {addPersonSheet}
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-layout tree-mode">
      <div className="workspace-heading">
        <div>
          <div className="eyebrow">Семейный архив / {demo ? "знакомство" : "моя семья"}</div>
          <h1>{family.title}</h1>
          <p>{family.region} <span aria-hidden="true">·</span> {family.people.length} {countNoun(family.people.length, "человек", "человека", "человек")}. Одна история.</p>
        </div>
        {canEdit ? <button className="primary-button" onClick={onOpenAddPerson} type="button">+ Добавить человека</button> : null}
      </div>
      <section className="tree-stage" id="tree-stage">
        <nav className="tree-dock" aria-label="Разделы семейного архива">
          <a className="tree-dock-item active" href="#tree-stage" aria-current="page">
            <TreeGlyph className="dock-icon" />
            <span>Дерево</span>
          </a>
          <a className="tree-dock-item" href="#people-panel">
            <PersonGlyph className="dock-icon" />
            <span>Люди <small>{family.people.length}</small></span>
          </a>
          <a className="tree-dock-item" href="#memory-panel">
            <GroupGlyph className="dock-icon" />
            <span>Воспоминания</span>
          </a>
          {!demo ? <Link className="tree-dock-item" href={`/family/${family.slug}/journal`}>
            <BookGlyph className="dock-icon" />
            <span>Журнал</span>
          </Link> : null}
        </nav>

        <div className="tree-board">
          <div className="tree-board-header">
            <div>
              <h2>{displayMode === "pyramid" ? "Пирамида семьи" : "Круг семьи"}</h2>
              <span className="workspace-count" role="status">
                {activeMode === "close" ? `Близкие родственники · ${layout.nodes.length} из ${family.people.length}` : `Вся семья · ${family.people.length} ${countNoun(family.people.length, "человек", "человека", "человек")}`}
              </span>
              <div className="tree-selection-options">
                <label className="tree-hide-others" title="Оставить близких родственников: родителей, детей, супругов, братьев и сестёр, бабушек и дедушек, внуков, дядь и тёть, племянников и ближайшую родню по браку">
                  <input type="checkbox" name="tree-hide-others" checked={Boolean(focusPerson) && hideOthers} disabled={!focusPerson} onChange={(event) => setHideOthers(event.target.checked)} />
                  <span>Скрыть остальных</span>
                </label>
                {focusPerson ? <button className="tree-clear-selection" type="button" onClick={clearSelection} title="Вернуться к обзору всей семьи">
                  <span aria-hidden="true">×</span> Снять выбор
                </button> : null}
              </div>
            </div>
            <div className="workspace-search">
              <label className="sr-only" htmlFor="person-search">Найти человека в семье</label>
              <input ref={searchInputRef} id="person-search" type="search" placeholder="Найти человека…" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setSearch(""); }} aria-controls={search.trim() ? "person-search-results" : undefined} />
              {search.trim() ? <div className="workspace-search-results" id="person-search-results" aria-live="polite">
                {matchedPeople.length ? matchedPeople.map((person) => <button type="button" key={person.id} onClick={() => selectPerson(person.id)}>{getPersonFullName(person)}<small>{person.birthDate}</small></button>) : <p>Никого не нашли. Попробуйте другое имя.</p>}
              </div> : null}
            </div>
            <div className="tree-board-controls">
              <button
                aria-label="Уменьшить"
                className="tree-control-button"
                onClick={onZoomOut}
                disabled={canvasScale <= TREE_MIN_SCALE}
                type="button"
              >
                <ZoomOutGlyph className="tree-control-icon" />
              </button>
              <span className="tree-scale" aria-live="polite">{Math.round(canvasScale * 100)}%</span>
              <button
                aria-label="Увеличить"
                className="tree-control-button"
                onClick={onZoomIn}
                disabled={canvasScale >= 1.4}
                type="button"
              >
                <ZoomInGlyph className="tree-control-icon" />
              </button>
              <button
                aria-label={activeMode === "close" ? "Уместить ветвь в окне" : "Уместить всю семью в окне"}
                className="tree-control-button"
                onClick={handleResetView}
                type="button"
              >
                <ExpandGlyph className="tree-control-icon" />
              </button>
            </div>
          </div>

          <div className="tree-arrangement-bar">
            <div className="tree-view-switch" role="group" aria-label="Вид дерева">
              <button type="button" aria-pressed={displayMode === "radial"} onClick={() => setDisplayMode("radial")}>Круг</button>
              <button type="button" aria-pressed={displayMode === "pyramid"} onClick={() => setDisplayMode("pyramid")}>Пирамида</button>
            </div>
            <p id="tree-move-help">Двигайте круги по отдельности, фон — для перемещения схемы. <span>Shift + стрелки — двигать круг с клавиатуры.</span></p>
            <div className="tree-arrangement-actions">
              <button className="ghost-button" type="button" disabled={!hasManualPositions} onClick={resetNodePositions}>Сбросить расположение</button>
              <button className="ghost-button tree-export-trigger" type="button" onClick={() => setExportOpen(true)}>Экспорт PNG / PDF</button>
            </div>
            <span className="sr-only" role="status">{moveMessage}</span>
          </div>
          <TreeExportDialog family={family} layout={exportCircleLayout} open={exportOpen} onClose={() => setExportOpen(false)} />

          <div className="tree-perspective">
            <label htmlFor="tree-perspective-person">Родство относительно</label>
            <select id="tree-perspective-person" value={focusPerson?.id ?? ""} onChange={(event) => event.target.value ? selectPerson(event.target.value) : clearSelection()}>
              <option value="">Выберите человека</option>
              {family.people.map((person) => <option key={person.id} value={person.id}>{getPersonFullName(person)}</option>)}
            </select>
            <span>{displayMode === "pyramid" ? `Старшие поколения — сверху, младшие — ниже. ${focusPerson ? "Подписи показывают родство с выбранным человеком." : "Выберите человека, чтобы увидеть названия родства."}` : focusPerson ? "Выбранный человек — в центре. Подписи показывают родство с ним." : "Выберите человека, чтобы увидеть названия родства."}</span>
          </div>

          {feedbackMessage ? <div className="banner-success tree-banner" role="status">{feedbackMessage}</div> : null}
          {addPersonSheet}

          <section className={`tree-canvas-shell${!focusPerson ? " is-overview" : ""}`}>
            <div className="tree-canvas-rings" />

            <div
              className={`tree-pan-surface${isDragging ? " dragging" : ""}`}
              onPointerCancel={handleCanvasPointerCancel}
              onLostPointerCapture={handleCanvasPointerCancel}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              ref={panSurfaceRef}
              role="region"
              aria-label="Семейное дерево"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Escape" && pointerStateRef.current) {
                  const state = pointerStateRef.current;
                  pointerStateRef.current = null;
                  setIsDragging(false);
                  if (state.personId && state.scope === positionScope) setNodeOffset(state.personId, { x: state.originX, y: state.originY });
                  else if (!state.personId) setPanOffset({ x: state.originX, y: state.originY });
                  if (event.currentTarget.hasPointerCapture(state.pointerId)) event.currentTarget.releasePointerCapture(state.pointerId);
                  event.preventDefault();
                  return;
                }
                if (event.key === "Escape" && focusPerson) {
                  event.preventDefault();
                  clearSelection();
                }
              }}
            >
              <div
                className="tree-canvas-scene"
                style={{
                  transform: `translate3d(${panOffset.x}px, ${panOffset.y}px, 0) scale(${canvasScale})`,
                  transition: isDragging ? "none" : undefined,
                }}
              >
                <div
                  className="tree-diagram"
                  data-tree-layout={displayMode}
                  style={{ width: diagramWidth, height: diagramHeight, position: "relative" }}
                >
                  <svg
                    aria-hidden="true"
                    className="tree-links-svg"
                    preserveAspectRatio="xMinYMin meet"
                    viewBox={`0 0 ${diagramWidth} ${diagramHeight}`}
                  >
                    {"pyramidOutline" in layout && typeof layout.pyramidOutline === "string" ? <path className="tree-pyramid-outline" d={layout.pyramidOutline} /> : null}
                    {layout.rings.map((ring) => (
                      <circle className="tree-orbit" key={ring.level} cx={diagramWidth / 2} cy={diagramHeight / 2} r={ring.radius} />
                    ))}
                    {layout.links.map((link) => (
                      <path className={`tree-relation ${link.type === "sibling" ? "is-sibling" : link.type === "spouse" || link.relationshipKeys?.every((key) => key.startsWith("spouse:")) ? "is-spouse" : "is-parent"}`} d={link.d} key={link.key} />
                    ))}
                  </svg>

                  {layout.nodes.map((node) => (
                    <div
                      className="tree-node-anchor"
                      key={node.person.id}
                      style={{
                        left: node.x - (node.size ?? layout.nodeSize) / 2,
                        top: node.y - (node.size ?? layout.nodeSize) / 2,
                      }}
                    >
                      <TreeNode
                        isFocus={node.isFocus}
                        isContext={node.isContext}
                        person={node.person}
                        role={node.role}
                        size={node.size ?? layout.nodeSize}
                        relationPath={relationPath(node.person.id)}
                        onSelect={selectPerson}
                        onMove={moveNodeWithKeyboard}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="tree-hint">
                <div className="tree-link-legend"><span><i className="tree-legend-dot" />Родители и дети</span><span><i className="tree-legend-dot is-spouse" />Супруги</span><span><i className="tree-legend-dot is-sibling" />Братья и сёстры</span></div>
                Перетаскивайте человека, чтобы изменить его положение. Короткое нажатие — выбрать.
              </div>

              <div className="tree-minimap">
                <div className="tree-minimap-title">Миникарта</div>
                <button className="tree-minimap-body" aria-label={`Навигация по дереву; Enter — ${focusPerson ? "к выбранному человеку" : "к центру дерева"}`} onClick={handleMinimapNavigate} type="button">
                  <svg
                    aria-hidden="true"
                    className="tree-minimap-svg"
                    preserveAspectRatio="xMidYMid meet"
                    viewBox={`0 0 ${minimapWidth} ${minimapHeight}`}
                  >
                    {layout.nodes.map((node) => (
                      <circle
                        cx={(node.x / diagramWidth) * minimapWidth}
                        cy={(node.y / diagramHeight) * minimapHeight}
                        fill={node.isFocus ? "#a33b36" : "#aaa394"}
                        key={`minimap-${node.person.id}`}
                        r={node.isFocus ? 7 : node.isContext ? 3 : 5}
                      />
                    ))}
                    <rect
                      className="tree-minimap-viewport"
                      height={minimapViewport.height}
                      rx="10"
                      ry="10"
                      width={minimapViewport.width}
                      x={minimapViewport.x}
                      y={minimapViewport.y}
                    />
                  </svg>
                </button>
              </div>
            </div>

            {focusPerson ? <aside className="tree-inspector" aria-label="Карточка выбранного человека">
              <div className="tree-inspector-header">
                <div className="eyebrow">Личная страница</div>
                <button
                  className="tree-inspector-close"
                  type="button"
                  aria-label="Закрыть карточку человека"
                  title="Снять выбор и показать всю семью"
                  onClick={clearSelection}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
              <div className="tree-inspector-portrait" aria-hidden="true">{getInitials(focusPerson)}</div>
              <h2>{getPersonFullName(focusPerson)}</h2>
              <div className="tree-inspector-meta">
                <span>{focusPerson.birthDate}{focusPerson.deathDate ? ` — ${focusPerson.deathDate}` : ""}</span>
                <span>{focusPerson.birthPlace}</span>
              </div>
              <p className="tree-inspector-summary user-text">{focusPerson.biography || "История этого человека ещё не записана."}</p>
              {focusPerson.note ? <p className="note-box user-text">{focusPerson.note}</p> : null}

              <div className="metrics-grid compact">
                <div>
                  <strong>{focusPerson.media.photos}</strong>
                  <span>фото</span>
                </div>
                <div>
                  <strong>{focusPerson.media.audio}</strong>
                  <span>аудио</span>
                </div>
                <div>
                  <strong>{focusPerson.stories.length}</strong>
                  <span>{countNoun(focusPerson.stories.length, "история", "истории", "историй")}</span>
                </div>
              </div>

              <div className="tree-inspector-relatives">
                {relativeBadges.length ? <div className="inspector-section-label">Связи в семье</div> : null}
                {relativeBadges.map((relative) => (
                  <button
                    className="person-badge"
                    key={`${relative.role}-${relative.person.id}`}
                    onClick={() => selectPerson(relative.person.id)}
                    title={relationPath(relative.person.id)}
                    type="button"
                  >
                    <small>{relative.role}</small>
                    <strong>{getPersonFullName(relative.person)}</strong>
                  </button>
                ))}
              </div>

              <div className="tree-inspector-actions">
                {canEdit ? (
                  <>
                    <button className="primary-button full-width" onClick={onOpenAddPerson} type="button">
                      Добавить человека
                    </button>
                    {onOpenAddRelationship ? <button className="ghost-button full-width" onClick={onOpenAddRelationship} type="button">
                      Связи человека
                    </button> : null}
                    <button className="ghost-button full-width" onClick={onOpenEditPerson} type="button">
                      Редактировать человека
                    </button>
                    <button className="ghost-button full-width" onClick={onOpenUploadMedia} type="button">
                      Добавить фото или голос
                    </button>
                    <button className="ghost-button full-width" onClick={onOpenCreateStory} type="button">
                      Добавить историю
                    </button>
                    <button
                      className="ghost-button full-width danger-button"
                      onClick={onArchivePerson}
                      type="button"
                    >
                      Архивировать человека
                    </button>
                  </>
                ) : !demo ? (
                  <div className="note-box">Режим просмотра. Редактирование доступно участникам с правом внесения изменений.</div>
                ) : <Link className="primary-button full-width" href="/register">Начать свою историю <span aria-hidden="true">↗</span></Link>}
              </div>
            </aside> : null}
          </section>

          <div className="tree-board-footer">
            <div className="tree-summary-pill">{family.region}</div>
            <div className="tree-summary-pill">{family.people.length} {countNoun(family.people.length, "человек", "человека", "человек")} в дереве</div>
            <div className="tree-summary-pill">{family.stats.stories} {countNoun(family.stats.stories, "история", "истории", "историй")}</div>
            {!demo ? <nav className="tree-family-links" aria-label="Управление семейным архивом">
              <Link href={`/family/${family.slug}/archive`}>Архив семьи</Link>
              <Link href={`/family/${family.slug}/journal`}>Журнал изменений</Link>
              <Link href={`/family/${family.slug}/members`}>Участники семьи</Link>
            </nav> : null}
          </div>
        </div>
      </section>

      <div className="workspace-secondary-grid">
        <aside className="workspace-sidebar">
          <div className="sidebar-block" id="people-panel">
            <div className="eyebrow">Люди в дереве</div>
            <div className="member-list">
              {family.people.map((person) => {
                const isActive = person.id === focusPerson?.id;

                return (
                  <button
                    className={`member-link${isActive ? " active" : ""}`}
                    aria-pressed={isActive}
                    key={person.id}
                    onClick={() => selectPerson(person.id)}
                    type="button"
                  >
                    <strong>{getPersonFullName(person)}</strong>
                    <span>
                      {person.birthDate}
                      {person.birthPlace ? `, ${person.birthPlace}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {family.auditLog.length ? <div className="sidebar-block">
            <div className="eyebrow">Последние изменения</div>
            <div className="task-list">
              {family.auditLog.slice(0, 4).map((entry) => (
                <div className="task-card" key={entry.id}>
                  <strong>{entry.actorName}</strong>
                  <span>{entry.message}</span>
                </div>
              ))}
            </div>
          </div> : null}
        </aside>

        {focusPerson ? <section className="detail-grid">
          <article className="detail-card">
            <div className="eyebrow">Фотоархив</div>
            <h2>Моменты, которые остаются</h2>
            <div className="media-section">
              <div className="media-header">
                <h3>Фотографии</h3>
                <span>{focusPerson.mediaAssets.filter((asset) => asset.type === "photo").length}</span>
              </div>
              <div className="photo-grid">
                {focusPerson.mediaAssets.filter((asset) => asset.type === "photo").length ? (
                  focusPerson.mediaAssets
                    .filter((asset) => asset.type === "photo")
                    .map((asset) => (
                      <div className="photo-card" key={asset.id}>
                        <a href={asset.url} target="_blank" rel="noopener noreferrer">
                          <Image alt={asset.title} src={asset.url} width={480} height={320} unoptimized />
                        </a>
                        <div className="media-card-footer">
                          <strong>{asset.title}</strong>
                          {canEdit ? (
                            <button
                              className="media-delete"
                              onClick={() => onDeleteMedia?.(asset)}
                              type="button"
                            >
                              Удалить
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))
                ) : (
                  <div className="empty-media">Первый снимок — начало большого альбома. {canEdit ? <button className="secondary-button" type="button" onClick={onOpenUploadMedia}>Добавить фотографию</button> : "Здесь будут фотографии этого человека."}</div>
                )}
              </div>
            </div>
          </article>

          <article className="detail-card" id="memory-panel">
            <div className="eyebrow">Лента памяти</div>
            <h2>За именем — целая жизнь</h2>
            <ul className="timeline">
              {focusPerson.timeline.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>

            <PersonStories person={focusPerson} canEdit={canEdit} onEdit={onEditStory} onDelete={onDeleteStory} onRestore={onRestoreStory} focusRevision={storyFocusRevision} />

            {focusPerson.memory ? (
              <div className="voice-box">
                <div>
                  <small>Голосовое сообщение, {focusPerson.memory.duration}</small>
                  <strong>{focusPerson.memory.title}</strong>
                  <p>{focusPerson.memory.summary}</p>
                </div>
              </div>
            ) : (
              <div className="empty-voice">Для этого человека голосовая история еще не добавлена.</div>
            )}

            <div className="media-section audio">
              <div className="media-header">
                <h3>Голосовые и аудио</h3>
                <span>{focusPerson.mediaAssets.filter((asset) => asset.type === "audio").length}</span>
              </div>
              <div className="audio-list">
                {focusPerson.mediaAssets.filter((asset) => asset.type === "audio").length ? (
                  focusPerson.mediaAssets
                    .filter((asset) => asset.type === "audio")
                    .map((asset) => (
                      <div className="audio-card" key={asset.id}>
                        <div>
                          <strong>{asset.title}</strong>
                          <small>{asset.mimeType}</small>
                        </div>
                        <audio controls preload="none" src={asset.url} />
                        {canEdit ? (
                          <button
                            className="media-delete"
                            onClick={() => onDeleteMedia?.(asset)}
                            type="button"
                          >
                            Удалить
                          </button>
                        ) : null}
                      </div>
                    ))
                ) : (
                  <div className="empty-media">Голосовые файлы для этого человека еще не загружены.</div>
                )}
              </div>
            </div>
          </article>
        </section> : <section className="detail-card family-overview-note" id="memory-panel">
          <div className="eyebrow">Обзор семьи</div>
          <h2>У каждого имени — своя история</h2>
          <p>Сейчас показано всё дерево. Выберите человека на схеме или в списке, чтобы открыть его фотографии, воспоминания и связи с близкими.</p>
        </section>}
      </div>
    </section>
  );
}
