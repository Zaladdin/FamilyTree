import type { FamilyTreeLayout } from "@/lib/family-utils";

export const TREE_MIN_SCALE = 0.01;
export const TREE_MAX_SCALE = 1.4;
const SCALE_PRECISION = 10_000;

/** Map a click through the SVG's xMidYMid/meet letterboxing. */
export function minimapScenePoint(
  pointer: { x: number; y: number },
  box: { left: number; top: number; width: number; height: number },
  diagram: { width: number; height: number },
) {
  const scale = Math.min(box.width / diagram.width, box.height / diagram.height);
  if (!Number.isFinite(scale) || scale <= 0) return { x: diagram.width / 2, y: diagram.height / 2 };
  const left = box.left + (box.width - diagram.width * scale) / 2;
  const top = box.top + (box.height - diagram.height * scale) / 2;
  return {
    x: Math.min(diagram.width, Math.max(0, (pointer.x - left) / scale)),
    y: Math.min(diagram.height, Math.max(0, (pointer.y - top) / scale)),
  };
}

export function normalizeTreeScale(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(TREE_MAX_SCALE, Math.max(
    TREE_MIN_SCALE,
    Math.round(value * SCALE_PRECISION) / SCALE_PRECISION,
  ));
}

export function fitTreeViewport(
  viewport: { width: number; height: number },
  diagram: {
    width: number;
    height: number;
    nodeSize: number;
    nodes?: FamilyTreeLayout["nodes"];
    pyramidOutline?: string;
    pyramidLevels?: Array<{ y: number; halfWidth: number }>;
  },
) {
  const pyramidLevels = diagram.pyramidOutline ? diagram.pyramidLevels?.filter((level) => Number.isFinite(level.y) && Number.isFinite(level.halfWidth) && level.halfWidth > 0) : undefined;
  if (pyramidLevels?.length) {
    // Unlike radial margins, the pyramid's upper margin contains its apex.
    // Include all decorative bands and any manually moved circles in the fit.
    const nodes = diagram.nodes?.filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y)) ?? [];
    const halfWidth = Math.max(...pyramidLevels.map((level) => level.halfWidth));
    const left = Math.min(diagram.width / 2 - halfWidth, ...nodes.map((node) => node.x - (node.size ?? diagram.nodeSize) / 2));
    const right = Math.max(diagram.width / 2 + halfWidth, ...nodes.map((node) => node.x + (node.size ?? diagram.nodeSize) / 2));
    // buildFamilyPyramidLayout anchors the decorative apex at scene y=48.
    const top = Math.min(48, ...nodes.map((node) => node.y - (node.size ?? diagram.nodeSize) / 2));
    const bottom = Math.max(...pyramidLevels.map((level) => level.y), ...nodes.map((node) => node.y + (node.size ?? diagram.nodeSize) / 2));
    const fittedScale = Math.min(1, (viewport.width - 48) / Math.max(right - left, diagram.nodeSize), (viewport.height - 112) / Math.max(bottom - top, diagram.nodeSize));
    const scale = normalizeTreeScale(Math.floor(fittedScale * SCALE_PRECISION) / SCALE_PRECISION);
    return {
      scale,
      x: viewport.width / 2 - (left + right) / 2 * scale,
      y: viewport.height / 2 - (top + bottom) / 2 * scale,
    };
  }
  // The layout reserves 150px around its nodes. Leave room for the canvas legend.
  const contentWidth = Math.max(diagram.width - 300, diagram.nodeSize);
  const contentHeight = Math.max(diagram.height - 300, diagram.nodeSize);
  const fittedScale = Math.min(
    1,
    (viewport.width - 48) / contentWidth,
    (viewport.height - 112) / contentHeight,
  );
  // Large overviews can need less than 35%, particularly on mobile. Round down
  // so rounding cannot make the content wider than its fitted viewport.
  const scale = normalizeTreeScale(Math.floor(fittedScale * SCALE_PRECISION) / SCALE_PRECISION);

  return {
    scale,
    x: (viewport.width - diagram.width * scale) / 2,
    y: (viewport.height - 40 - diagram.height * scale) / 2,
  };
}

export function focusTreeViewport(
  viewport: { width: number; height: number },
  diagram: FamilyTreeLayout,
  focusPersonId: string,
  preferredScale = 1,
) {
  const node = diagram.nodes.find((candidate) => candidate.person.id === focusPersonId);
  if (!node) return fitTreeViewport(viewport, diagram);

  const nodeSize = node.size ?? diagram.nodeSize;
  const usableHeight = viewport.height - 40;
  // Fit this card, not its relatives: selecting a person must zoom back in even
  // when the complete family needs a much smaller overview scale.
  const fittedScale = Math.min(
    normalizeTreeScale(preferredScale),
    (viewport.width - 48) / nodeSize,
    (usableHeight - 112) / nodeSize,
  );
  const scale = normalizeTreeScale(Math.floor(fittedScale * SCALE_PRECISION) / SCALE_PRECISION);

  return {
    scale,
    x: viewport.width / 2 - node.x * scale,
    y: usableHeight / 2 - node.y * scale,
  };
}

export function zoomAroundCenter(
  offset: { x: number; y: number },
  viewport: { width: number; height: number },
  previousScale: number,
  nextScale: number,
) {
  const ratio = nextScale / previousScale;
  return {
    x: viewport.width / 2 - (viewport.width / 2 - offset.x) * ratio,
    y: viewport.height / 2 - (viewport.height / 2 - offset.y) * ratio,
  };
}
