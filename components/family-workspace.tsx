"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from "react";
import { getFocusRelatives, getPersonFullName } from "@/lib/family-utils";
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

type TreeNodeVariant = "focus" | "medium" | "small";

type TreeNodeProps = {
  person: FamilyPerson;
  role: string;
  variant: TreeNodeVariant;
  onClick?: (personId: string) => void;
};

type IconProps = {
  className?: string;
};

type DragOrigin = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

type DiagramNode = {
  person: FamilyPerson;
  role: string;
  variant: TreeNodeVariant;
  x: number;
  y: number;
};

const DIAGRAM_WIDTH = 860;
const DIAGRAM_HEIGHT = 760;
const FOCUS_CENTER = { x: 286, y: 404 };
const SPOUSE_CENTER = { x: 556, y: 432 };
const PARENT_CENTERS = [
  { x: 220, y: 122 },
  { x: 540, y: 122 },
];
const SIBLING_POSITIONS = [
  { x: 716, y: 348 },
  { x: 716, y: 546 },
];
const MIN_SCALE = 0.72;
const MAX_SCALE = 1.48;

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

function getRoleLabel(group: "parent" | "spouse" | "child" | "sibling", person: FamilyPerson) {
  if (group === "parent") {
    return person.gender === "male" ? "Отец" : "Мать";
  }

  if (group === "spouse") {
    return person.gender === "male" ? "Супруг" : "Жена";
  }

  if (group === "child") {
    return person.gender === "male" ? "Сын" : "Дочь";
  }

  return person.gender === "male" ? "Брат" : "Сестра";
}

function getAccent(index: number) {
  return ["emerald", "amber", "sky", "rose", "violet"][index % 5];
}

function getFocusSummary(person: FamilyPerson) {
  return `${person.birthDate}, ${person.birthPlace}. ${person.biography}`;
}

function getNodeSize(variant: TreeNodeVariant) {
  if (variant === "focus") {
    return 312;
  }

  if (variant === "medium") {
    return 222;
  }

  return 188;
}

function getChildCenters(count: number) {
  const startX = 428 - ((count - 1) * 168) / 2;
  return Array.from({ length: count }, (_, index) => ({
    x: startX + index * 168,
    y: 646,
  }));
}

function getSiblingCenters(count: number) {
  if (count <= SIBLING_POSITIONS.length) {
    return SIBLING_POSITIONS.slice(0, count);
  }

  const startY = 314;
  return Array.from({ length: count }, (_, index) => ({
    x: 716,
    y: startY + index * 146,
  }));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getNodeFrame(node: DiagramNode) {
  const size = getNodeSize(node.variant);

  return {
    size,
    left: node.x - size / 2,
    top: node.y - size / 2,
  };
}

function TreeNode({ person, role, variant, onClick }: TreeNodeProps) {
  const isInteractive = Boolean(onClick);

  return (
    <button
      className={`gene-node ${variant}${isInteractive ? " interactive" : ""}`}
      onClick={() => onClick?.(person.id)}
      type="button"
    >
      <div className="gene-node-badge">
        {variant === "focus" ? (
          <TreeGlyph className="node-icon" />
        ) : (
          <PersonGlyph className="node-icon" />
        )}
      </div>
      <div className="gene-node-copy">
        <strong>{getPersonFullName(person)}</strong>
        {variant === "focus" ? <p>{getFocusSummary(person)}</p> : <span>{role}</span>}
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
  const [expandedChildren, setExpandedChildren] = useState(false);
  const [expandedSiblings, setExpandedSiblings] = useState(false);
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });
  const dragOriginRef = useRef<DragOrigin | null>(null);
  const panSurfaceRef = useRef<HTMLDivElement | null>(null);
  const focusPerson = family.people.find((person) => person.id === focusPersonId) ?? family.people[0];
  const relatives = getFocusRelatives(family, focusPerson.id);
  const [leftParent, rightParent] = relatives.parents.slice(0, 2);
  const primarySpouse = relatives.spouses[0];
  const siblingNodes = expandedSiblings ? relatives.siblings : relatives.siblings.slice(0, 2);
  const childNodes = expandedChildren ? relatives.children : relatives.children.slice(0, 3);
  const hiddenSiblingCount = Math.max(relatives.siblings.length - siblingNodes.length, 0);
  const hiddenChildCount = Math.max(relatives.children.length - childNodes.length, 0);
  const relativeBadges = [
    ...relatives.parents.map((person) => ({
      role: getRoleLabel("parent", person),
      person,
    })),
    ...relatives.spouses.map((person) => ({
      role: getRoleLabel("spouse", person),
      person,
    })),
    ...relatives.children.map((person) => ({
      role: getRoleLabel("child", person),
      person,
    })),
    ...relatives.siblings.map((person) => ({
      role: getRoleLabel("sibling", person),
      person,
    })),
  ];

  useEffect(() => {
    setExpandedChildren(false);
    setExpandedSiblings(false);
    setPanOffset({ x: 0, y: 0 });
  }, [focusPersonId]);

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

  const parentDiagramNodes: DiagramNode[] = [leftParent, rightParent]
    .filter((person): person is FamilyPerson => Boolean(person))
    .map((person, index) => ({
      person,
      role: getRoleLabel("parent", person),
      variant: "medium",
      x: PARENT_CENTERS[index]?.x ?? PARENT_CENTERS[0].x,
      y: PARENT_CENTERS[index]?.y ?? PARENT_CENTERS[0].y,
    }));

  const focusDiagramNode: DiagramNode = {
    person: focusPerson,
    role: "Центр дерева",
    variant: "focus",
    x: FOCUS_CENTER.x,
    y: FOCUS_CENTER.y,
  };

  const spouseDiagramNode: DiagramNode | null = primarySpouse
    ? {
        person: primarySpouse,
        role: getRoleLabel("spouse", primarySpouse),
        variant: "small",
        x: SPOUSE_CENTER.x,
        y: SPOUSE_CENTER.y,
      }
    : null;

  const childDiagramNodes: DiagramNode[] = childNodes.map((person, index) => {
    const center = getChildCenters(childNodes.length)[index];

    return {
      person,
      role: getRoleLabel("child", person),
      variant: "small",
      x: center.x,
      y: center.y,
    };
  });

  const siblingDiagramNodes: DiagramNode[] = siblingNodes.map((person, index) => {
    const center = getSiblingCenters(siblingNodes.length)[index];

    return {
      person,
      role: getRoleLabel("sibling", person),
      variant: "small",
      x: center.x,
      y: center.y,
    };
  });

  const treePaths: ReactNode[] = [];

  if (parentDiagramNodes.length === 2) {
    const [parentLeft, parentRight] = parentDiagramNodes;
    const parentRadius = getNodeSize("medium") / 2;
    const unionX = (parentLeft.x + parentRight.x) / 2;
    const relationY = parentLeft.y;
    const generationY = 236;
    const sameGenerationNodes = [focusDiagramNode, ...siblingDiagramNodes];
    const relationMinX = Math.min(...sameGenerationNodes.map((node) => node.x));
    const relationMaxX = Math.max(...sameGenerationNodes.map((node) => node.x));

    treePaths.push(
      <path
        d={`M ${parentLeft.x + parentRadius - 12} ${relationY} H ${parentRight.x - parentRadius + 12}`}
        key="parents-link"
      />,
    );
    treePaths.push(<path d={`M ${unionX} ${relationY} V ${generationY}`} key="parents-drop" />);

    treePaths.push(
      <path d={`M ${relationMinX} ${generationY} H ${relationMaxX}`} key="generation-line" />,
    );

    sameGenerationNodes.forEach((node) => {
      const radius = getNodeSize(node.variant) / 2;
      treePaths.push(
        <path
          d={`M ${node.x} ${generationY} V ${node.y - radius + 8}`}
          key={`generation-branch-${node.person.id}`}
        />,
      );
    });
  } else if (parentDiagramNodes.length === 1) {
    const [parentOnly] = parentDiagramNodes;
    const parentRadius = getNodeSize("medium") / 2;

    treePaths.push(
      <path
        d={`M ${parentOnly.x} ${parentOnly.y + parentRadius - 10} V ${focusDiagramNode.y - getNodeSize("focus") / 2 + 10}`}
        key="single-parent-drop"
      />,
    );
  }

  if (spouseDiagramNode) {
    const focusRadius = getNodeSize("focus") / 2;
    const spouseRadius = getNodeSize("small") / 2;

    treePaths.push(
      <path
        d={`M ${focusDiagramNode.x + focusRadius - 10} ${spouseDiagramNode.y} H ${spouseDiagramNode.x - spouseRadius + 10}`}
        key="spouse-link"
      />,
    );
  }

  if (childDiagramNodes.length) {
    const originX = spouseDiagramNode
      ? (focusDiagramNode.x + spouseDiagramNode.x) / 2
      : focusDiagramNode.x;
    const originY = spouseDiagramNode
      ? spouseDiagramNode.y
      : focusDiagramNode.y + getNodeSize("focus") / 2 - 16;
    const hubY = 552;
    const minChildX = Math.min(...childDiagramNodes.map((node) => node.x));
    const maxChildX = Math.max(...childDiagramNodes.map((node) => node.x));

    treePaths.push(<path d={`M ${originX} ${originY} V ${hubY}`} key="children-drop" />);

    if (childDiagramNodes.length > 1) {
      treePaths.push(<path d={`M ${minChildX} ${hubY} H ${maxChildX}`} key="children-line" />);
    }

    childDiagramNodes.forEach((node) => {
      const radius = getNodeSize("small") / 2;
      treePaths.push(
        <path d={`M ${node.x} ${hubY} V ${node.y - radius + 8}`} key={`child-branch-${node.person.id}`} />,
      );
    });
  }

  const minimapWidth = 176;
  const minimapHeight = Math.round((DIAGRAM_HEIGHT / DIAGRAM_WIDTH) * minimapWidth);
  const viewportX = clamp(-panOffset.x / canvasScale, 0, DIAGRAM_WIDTH);
  const viewportY = clamp(-panOffset.y / canvasScale, 0, DIAGRAM_HEIGHT);
  const viewportWidth = clamp(
    surfaceSize.width ? surfaceSize.width / canvasScale : DIAGRAM_WIDTH * 0.38,
    140,
    DIAGRAM_WIDTH,
  );
  const viewportHeight = clamp(
    surfaceSize.height ? surfaceSize.height / canvasScale : DIAGRAM_HEIGHT * 0.42,
    120,
    DIAGRAM_HEIGHT,
  );

  const minimapViewport = {
    x: (viewportX / DIAGRAM_WIDTH) * minimapWidth,
    y: (viewportY / DIAGRAM_HEIGHT) * minimapHeight,
    width: (viewportWidth / DIAGRAM_WIDTH) * minimapWidth,
    height: (viewportHeight / DIAGRAM_HEIGHT) * minimapHeight,
  };

  const minimapNodes = [
    ...parentDiagramNodes,
    focusDiagramNode,
    ...siblingDiagramNodes,
    ...childDiagramNodes,
    ...(spouseDiagramNode ? [spouseDiagramNode] : []),
  ];

  function handleCanvasPointerDown(event: PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;

    if (target.closest("button, a, input, textarea, select, audio")) {
      return;
    }

    dragOriginRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: panOffset.x,
      originY: panOffset.y,
    };
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCanvasPointerMove(event: PointerEvent<HTMLDivElement>) {
    const dragOrigin = dragOriginRef.current;

    if (!dragOrigin || dragOrigin.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragOrigin.startX;
    const deltaY = event.clientY - dragOrigin.startY;

    setPanOffset({
      x: dragOrigin.originX + deltaX,
      y: dragOrigin.originY + deltaY,
    });
  }

  function stopDragging(event: PointerEvent<HTMLDivElement>) {
    const dragOrigin = dragOriginRef.current;

    if (!dragOrigin || dragOrigin.pointerId !== event.pointerId) {
      return;
    }

    dragOriginRef.current = null;
    setIsDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleResetView() {
    setPanOffset({ x: 0, y: 0 });
    onResetZoom?.();
  }

  function handleCanvasWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();

    const surface = panSurfaceRef.current;

    if (!surface) {
      return;
    }

    const rect = surface.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const nextScale = clamp(
      Number((canvasScale + (event.deltaY < 0 ? 0.08 : -0.08)).toFixed(2)),
      MIN_SCALE,
      MAX_SCALE,
    );

    if (nextScale === canvasScale) {
      return;
    }

    const sceneX = (cursorX - panOffset.x) / canvasScale;
    const sceneY = (cursorY - panOffset.y) / canvasScale;

    setPanOffset({
      x: cursorX - sceneX * nextScale,
      y: cursorY - sceneY * nextScale,
    });
    onScaleChange?.(nextScale);
  }

  function handleMinimapNavigate(event: PointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratioX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const ratioY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const targetSceneX = ratioX * DIAGRAM_WIDTH;
    const targetSceneY = ratioY * DIAGRAM_HEIGHT;

    setPanOffset({
      x: -(targetSceneX * canvasScale - surfaceSize.width / 2),
      y: -(targetSceneY * canvasScale - surfaceSize.height / 2),
    });
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
                aria-label="Сбросить масштаб и позицию"
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
              onWheel={handleCanvasWheel}
              onPointerCancel={stopDragging}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={stopDragging}
              ref={panSurfaceRef}
            >
              <div
                className="tree-canvas-scene"
                style={{
                  transform: `translate3d(${panOffset.x}px, ${panOffset.y}px, 0) scale(${canvasScale})`,
                }}
              >
                <div className="tree-diagram">
                  <svg
                    aria-hidden="true"
                    className="tree-links-svg"
                    preserveAspectRatio="xMinYMin meet"
                    viewBox={`0 0 ${DIAGRAM_WIDTH} ${DIAGRAM_HEIGHT}`}
                  >
                    {treePaths}
                  </svg>

                  {parentDiagramNodes.map((node) => {
                    const frame = getNodeFrame(node);

                    return (
                      <div
                        className="tree-node-anchor"
                        key={node.person.id}
                        style={{ left: frame.left, top: frame.top }}
                      >
                        <TreeNode
                          onClick={onFocusPerson}
                          person={node.person}
                          role={node.role}
                          variant={node.variant}
                        />
                      </div>
                    );
                  })}

                  <div
                    className="tree-node-anchor"
                    style={{
                      left: getNodeFrame(focusDiagramNode).left,
                      top: getNodeFrame(focusDiagramNode).top,
                    }}
                  >
                    <TreeNode person={focusPerson} role="Центр дерева" variant="focus" />
                  </div>

                  {spouseDiagramNode ? (
                    <div
                      className="tree-node-anchor"
                      style={{
                        left: getNodeFrame(spouseDiagramNode).left,
                        top: getNodeFrame(spouseDiagramNode).top,
                      }}
                    >
                      <TreeNode
                        onClick={onFocusPerson}
                        person={spouseDiagramNode.person}
                        role={spouseDiagramNode.role}
                        variant={spouseDiagramNode.variant}
                      />
                    </div>
                  ) : null}

                  {siblingDiagramNodes.map((node) => {
                    const frame = getNodeFrame(node);

                    return (
                      <div
                        className="tree-node-anchor"
                        key={node.person.id}
                        style={{ left: frame.left, top: frame.top }}
                      >
                        <TreeNode
                          onClick={onFocusPerson}
                          person={node.person}
                          role={node.role}
                          variant={node.variant}
                        />
                      </div>
                    );
                  })}

                  {childDiagramNodes.map((node) => {
                    const frame = getNodeFrame(node);

                    return (
                      <div
                        className="tree-node-anchor"
                        key={node.person.id}
                        style={{ left: frame.left, top: frame.top }}
                      >
                        <TreeNode
                          onClick={onFocusPerson}
                          person={node.person}
                          role={node.role}
                          variant={node.variant}
                        />
                      </div>
                    );
                  })}

                  {hiddenSiblingCount ? (
                    <button
                      className="tree-branch-toggle siblings"
                      onClick={() => setExpandedSiblings(true)}
                      type="button"
                    >
                      +{hiddenSiblingCount} еще родственник{hiddenSiblingCount > 1 ? "а" : ""}
                    </button>
                  ) : null}

                  {expandedSiblings && relatives.siblings.length > 2 ? (
                    <button
                      className="tree-branch-toggle siblings collapse"
                      onClick={() => setExpandedSiblings(false)}
                      type="button"
                    >
                      Свернуть боковую ветку
                    </button>
                  ) : null}

                  {hiddenChildCount ? (
                    <button
                      className="tree-branch-toggle children"
                      onClick={() => setExpandedChildren(true)}
                      type="button"
                    >
                      +{hiddenChildCount} еще детей
                    </button>
                  ) : null}

                  {expandedChildren && relatives.children.length > 3 ? (
                    <button
                      className="tree-branch-toggle children collapse"
                      onClick={() => setExpandedChildren(false)}
                      type="button"
                    >
                      Свернуть линию детей
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="tree-hint">
                Перетаскивай холст мышью, крути колесо для zoom и нажимай на узлы для перехода.
              </div>

              <div className="tree-minimap">
                <div className="tree-minimap-title">Миникарта</div>
                <button className="tree-minimap-body" onPointerDown={handleMinimapNavigate} type="button">
                  <svg
                    aria-hidden="true"
                    className="tree-minimap-svg"
                    preserveAspectRatio="xMidYMid meet"
                    viewBox={`0 0 ${minimapWidth} ${minimapHeight}`}
                  >
                    {minimapNodes.map((node) => (
                      <circle
                        cx={(node.x / DIAGRAM_WIDTH) * minimapWidth}
                        cy={(node.y / DIAGRAM_HEIGHT) * minimapHeight}
                        fill={node.variant === "focus" ? "rgba(182, 83, 47, 0.9)" : "rgba(198, 152, 95, 0.72)"}
                        key={`minimap-${node.person.id}`}
                        r={node.variant === "focus" ? 7 : 5}
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
