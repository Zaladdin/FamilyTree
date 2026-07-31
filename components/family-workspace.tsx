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
  buildFamilyTreeLayout,
  getFocusRelatives,
  getPersonFullName,
  getRelationLabel,
} from "@/lib/family-utils";
import Link from "next/link";
import { Family, FamilyPerson, MediaAsset } from "@/lib/types";

type FamilyWorkspaceProps = {
  family: Family;
  focusPersonId: string;
  canEdit: boolean;
  canvasScale: number;
  onFocusPerson?: (personId: string) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetZoom?: () => void;
  onScaleChange?: (nextScale: number) => void;
  onOpenAddPerson?: () => void;
  onOpenEditPerson?: () => void;
  onOpenUploadMedia?: () => void;
  onOpenCreateStory?: () => void;
  onDeleteMedia?: (asset: MediaAsset) => void;
  onArchivePerson?: () => void;
  addPersonSheet?: ReactNode;
  feedbackMessage?: string;
};

type TreeNodeProps = {
  person: FamilyPerson;
  role: string;
  isFocus: boolean;
  size: number;
};

type IconProps = {
  className?: string;
};

type PointerState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  personId: string | null;
  moved: boolean;
};

const DRAG_THRESHOLD = 6;

const FOCUS_ACCENT = "#b6532f";

function TreeGlyph({ className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24">
      <path
        d="M12 5v14M12 10l-4-4M12 10l4-4M12 14l-5 5M12 14l5-5M7 9H4M20 9h-3M6 20H3M21 20h-3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function PersonGlyph({ className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24">
      <path
        d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 7a7 7 0 0 1 14 0"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function GroupGlyph({ className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24">
      <path
        d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 19a5.5 5.5 0 0 1 11 0M10.5 19a5.5 5.5 0 0 1 11 0"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function BookGlyph({ className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24">
      <path
        d="M4 6.5A2.5 2.5 0 0 1 6.5 4H20v15.5a.5.5 0 0 1-.5.5H7a3 3 0 0 0-3 3Zm0 0V20M12 4v19"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function ZoomOutGlyph({ className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24">
      <path
        d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm0-6.5h-3.5M20 20l-4.6-4.6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function ZoomInGlyph({ className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24">
      <path
        d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm0-6.5h-3.5M10.5 7v7M20 20l-4.6-4.6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function ExpandGlyph({ className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24">
      <path
        d="M15 4h5v5M20 4l-6 6M9 20H4v-5M4 20l6-6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function getAccent(index: number) {
  return ["emerald", "amber", "sky", "rose", "violet"][index % 5];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function TreeNode({ person, role, isFocus, size }: TreeNodeProps) {
  return (
    <button
      className={`gene-node small interactive${isFocus ? " is-focus" : ""}`}
      data-person-id={person.id}
      style={{
        width: size,
        height: size,
        ...(isFocus
          ? { outline: `3px solid ${FOCUS_ACCENT}`, outlineOffset: "2px" }
          : {}),
      }}
      type="button"
    >
      <div className="gene-node-badge">
        {isFocus ? <TreeGlyph className="node-icon" /> : <PersonGlyph className="node-icon" />}
      </div>
      <div className="gene-node-copy">
        <strong>{getPersonFullName(person)}</strong>
        <span>{role}</span>
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
  onOpenEditPerson,
  onOpenUploadMedia,
  onOpenCreateStory,
  onDeleteMedia,
  onArchivePerson,
  addPersonSheet,
  feedbackMessage,
}: FamilyWorkspaceProps) {
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });
  const pointerStateRef = useRef<PointerState | null>(null);
  const panSurfaceRef = useRef<HTMLDivElement | null>(null);
  const centeredFocusRef = useRef<string | null>(null);
  const focusPerson =
    family.people.find((person) => person.id === focusPersonId) ?? family.people[0];
  const relatives = focusPerson
    ? getFocusRelatives(family, focusPerson.id)
    : { parents: [], spouses: [], siblings: [], children: [] };
  const relativeBadges = [
    ...relatives.parents.map((person) => ({ role: getRelationLabel("parent", person), person })),
    ...relatives.spouses.map((person) => ({ role: getRelationLabel("spouse", person), person })),
    ...relatives.children.map((person) => ({ role: getRelationLabel("child", person), person })),
    ...relatives.siblings.map((person) => ({ role: getRelationLabel("sibling", person), person })),
  ];

  const layout = useMemo(
    () => buildFamilyTreeLayout(family, focusPerson?.id ?? ""),
    [family, focusPerson?.id],
  );

  const diagramWidth = Math.max(layout.width, 1);
  const diagramHeight = Math.max(layout.height, 1);

  function centerOnFocus(scale: number) {
    if (!surfaceSize.width || !surfaceSize.height) {
      return;
    }

    const focusNode = layout.nodes.find((node) => node.isFocus) ?? layout.nodes[0];

    if (!focusNode) {
      setPanOffset({ x: 0, y: 0 });
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

    // Center once per focus person. Never re-center on unrelated re-renders,
    // otherwise dragging / minimap navigation would be snapped back.
    if (centeredFocusRef.current === focusPerson?.id) {
      return;
    }

    centeredFocusRef.current = focusPerson?.id ?? null;
    centerOnFocus(canvasScale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPerson?.id, surfaceSize.width, surfaceSize.height]);

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
  }, []);

  const minimapWidth = 176;
  const minimapHeight = Math.max(
    Math.round((diagramHeight / diagramWidth) * minimapWidth),
    1,
  );
  const viewportX = clamp(-panOffset.x / canvasScale, 0, diagramWidth);
  const viewportY = clamp(-panOffset.y / canvasScale, 0, diagramHeight);
  const viewportWidth = clamp(
    surfaceSize.width ? surfaceSize.width / canvasScale : diagramWidth * 0.38,
    100,
    diagramWidth,
  );
  const viewportHeight = clamp(
    surfaceSize.height ? surfaceSize.height / canvasScale : diagramHeight * 0.42,
    80,
    diagramHeight,
  );

  const minimapViewport = {
    x: (viewportX / diagramWidth) * minimapWidth,
    y: (viewportY / diagramHeight) * minimapHeight,
    width: (viewportWidth / diagramWidth) * minimapWidth,
    height: (viewportHeight / diagramHeight) * minimapHeight,
  };

  function handleCanvasPointerDown(event: PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;

    // Let genuine controls (links, form fields, audio, the minimap) work as-is.
    // The tree nodes are handled here so a drag can start anywhere on the canvas.
    if (target.closest("a, input, textarea, select, audio, .tree-minimap")) {
      return;
    }

    const nodeElement = target.closest("[data-person-id]") as HTMLElement | null;

    pointerStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: panOffset.x,
      originY: panOffset.y,
      personId: nodeElement?.dataset.personId ?? null,
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
      setPanOffset({ x: state.originX + deltaX, y: state.originY + deltaY });
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
    if (!state.moved && state.personId) {
      onFocusPerson?.(state.personId);
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
  }

  function handleResetView() {
    onResetZoom?.();
    centerOnFocus(1);
  }

  function handleMinimapNavigate(event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratioX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const ratioY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const targetSceneX = ratioX * diagramWidth;
    const targetSceneY = ratioY * diagramHeight;

    setPanOffset({
      x: -(targetSceneX * canvasScale - surfaceSize.width / 2),
      y: -(targetSceneY * canvasScale - surfaceSize.height / 2),
    });
  }

  if (!focusPerson) {
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
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-layout tree-mode">
      <section className="tree-stage" id="tree-stage">
        <aside className="tree-dock">
          <a className="tree-dock-item active" href="#tree-stage">
            <TreeGlyph className="dock-icon" />
            <span className="sr-only">Дерево</span>
          </a>
          <a className="tree-dock-item" href="#people-panel">
            <PersonGlyph className="dock-icon" />
            <span className="sr-only">Люди</span>
          </a>
          <a className="tree-dock-item" href="#memory-panel">
            <GroupGlyph className="dock-icon" />
            <span className="sr-only">Родство</span>
          </a>
          <Link className="tree-dock-item" href={`/family/${family.slug}/journal`}>
            <BookGlyph className="dock-icon" />
            <span className="sr-only">Журнал</span>
          </Link>
        </aside>

        <div className="tree-board">
          <div className="tree-board-header">
            <div>
              <div className="eyebrow">Интерактивное дерево</div>
              <h1>{getPersonFullName(focusPerson)}</h1>
            </div>
            <div className="tree-board-controls">
              <button
                aria-label="Уменьшить"
                className="tree-control-button"
                onClick={onZoomOut}
                type="button"
              >
                <ZoomOutGlyph className="tree-control-icon" />
              </button>
              <button
                aria-label="Увеличить"
                className="tree-control-button"
                onClick={onZoomIn}
                type="button"
              >
                <ZoomInGlyph className="tree-control-icon" />
              </button>
              <button
                aria-label="Показать всё дерево и центрировать"
                className="tree-control-button"
                onClick={handleResetView}
                type="button"
              >
                <ExpandGlyph className="tree-control-icon" />
              </button>
            </div>
          </div>

          {feedbackMessage ? <div className="banner-success tree-banner">{feedbackMessage}</div> : null}
          {addPersonSheet}

          <section className="tree-canvas-shell">
            <div className="tree-canvas-rings" />

            <div
              className={`tree-pan-surface${isDragging ? " dragging" : ""}`}
              onPointerCancel={handleCanvasPointerCancel}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              ref={panSurfaceRef}
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
                  style={{ width: diagramWidth, height: diagramHeight, position: "relative" }}
                >
                  <svg
                    aria-hidden="true"
                    className="tree-links-svg"
                    preserveAspectRatio="xMinYMin meet"
                    viewBox={`0 0 ${diagramWidth} ${diagramHeight}`}
                  >
                    {layout.links.map((link) => (
                      <path d={link.d} key={link.key} />
                    ))}
                  </svg>

                  {layout.nodes.map((node) => (
                    <div
                      className="tree-node-anchor"
                      key={node.person.id}
                      style={{
                        left: node.x - layout.nodeSize / 2,
                        top: node.y - layout.nodeSize / 2,
                      }}
                    >
                      <TreeNode
                        isFocus={node.isFocus}
                        person={node.person}
                        role={node.role}
                        size={layout.nodeSize}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="tree-hint">
                Перетаскивай холст мышью, крути колесо для zoom и нажимай на узлы, чтобы центрировать человека.
              </div>

              <div className="tree-minimap">
                <div className="tree-minimap-title">Миникарта</div>
                <button className="tree-minimap-body" onClick={handleMinimapNavigate} type="button">
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
                        fill={node.isFocus ? "rgba(182, 83, 47, 0.9)" : "rgba(198, 152, 95, 0.72)"}
                        key={`minimap-${node.person.id}`}
                        r={node.isFocus ? 7 : 5}
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

            <aside className="tree-inspector">
              <div className="eyebrow">Карточка человека</div>
              <h2>{getPersonFullName(focusPerson)}</h2>
              <div className="tree-inspector-meta">
                <span>{focusPerson.birthDate}</span>
                <span>{focusPerson.birthPlace}</span>
              </div>
              <p className="tree-inspector-summary">{focusPerson.biography}</p>
              {focusPerson.note ? <p className="note-box">{focusPerson.note}</p> : null}

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
                  <span>истории</span>
                </div>
              </div>

              <div className="tree-inspector-relatives">
                {relativeBadges.slice(0, 6).map((relative, index) => (
                  <div
                    className={`person-badge ${getAccent(index)}`}
                    key={`${relative.role}-${relative.person.id}`}
                  >
                    <small>{relative.role}</small>
                    <strong>{getPersonFullName(relative.person)}</strong>
                  </div>
                ))}
              </div>

              <div className="tree-inspector-actions">
                {canEdit ? (
                  <>
                    <button className="primary-button full-width" onClick={onOpenAddPerson} type="button">
                      Добавить человека
                    </button>
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
                ) : (
                  <div className="note-box">Режим просмотра. Для изменений нужно войти как участник семьи.</div>
                )}
                <Link className="ghost-button full-width archive-link" href={`/family/${family.slug}/archive`}>
                  Открыть архив семьи
                </Link>
                <Link className="ghost-button full-width archive-link" href={`/family/${family.slug}/journal`}>
                  Открыть журнал изменений
                </Link>
              </div>
            </aside>
          </section>

          <div className="tree-board-footer">
            <div className="tree-summary-pill">{family.region}</div>
            <div className="tree-summary-pill">{family.stats.people} человек в дереве</div>
            <div className="tree-summary-pill">{family.stats.stories} историй</div>
          </div>
        </div>
      </section>

      <div className="workspace-secondary-grid">
        <aside className="workspace-sidebar">
          <div className="sidebar-block" id="people-panel">
            <div className="eyebrow">Люди в дереве</div>
            <div className="member-list">
              {family.people.map((person) => {
                const isActive = person.id === focusPerson.id;

                return (
                  <button
                    className={`member-link${isActive ? " active" : ""}`}
                    key={person.id}
                    onClick={() => onFocusPerson?.(person.id)}
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

          <div className="sidebar-block">
            <div className="eyebrow">Последние изменения</div>
            <div className="task-list">
              {family.auditLog.slice(0, 4).map((entry) => (
                <div className="task-card" key={entry.id}>
                  <strong>{entry.actorName}</strong>
                  <span>{entry.message}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className="detail-grid">
          <article className="detail-card">
            <div className="eyebrow">Фотоархив</div>
            <h2>Фотографии и визуальная память</h2>
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
                        <a href={asset.url} target="_blank">
                          <img alt={asset.title} src={asset.url} />
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
                  <div className="empty-media">Фотографии для этого человека еще не загружены.</div>
                )}
              </div>
            </div>
          </article>

          <article className="detail-card" id="memory-panel">
            <div className="eyebrow">Лента памяти</div>
            <h2>Ключевые события и голос семьи</h2>
            <ul className="timeline">
              {focusPerson.timeline.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>

            <div className="story-section">
              <div className="media-header">
                <h3>Истории и легенды</h3>
                <span>{focusPerson.stories.length}</span>
              </div>
              <div className="story-list">
                {focusPerson.stories.length ? (
                  focusPerson.stories.map((story) => (
                    <article className="story-card" key={story.id}>
                      <div className="story-card-header">
                        <strong>{story.title}</strong>
                        {story.narrator ? <small>{story.narrator}</small> : null}
                      </div>
                      <p>{story.body}</p>
                    </article>
                  ))
                ) : (
                  <div className="empty-media">
                    Для этого человека текстовые истории еще не добавлены.
                  </div>
                )}
              </div>
            </div>

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
        </section>
      </div>
    </section>
  );
}
