import type { Family } from "@/lib/types";
import type { FamilyTreeLayoutNode } from "@/lib/family-utils";
import type { FamilyRadialLayout } from "@/lib/family-radial-layout";
import { buildFamilyPyramidLayout } from "@/lib/family-pyramid-layout";
import { buildOrthogonalFamilyLinks, FAMILY_CARD_WIDTH, FAMILY_CARD_HEIGHT } from "@/lib/family-orthogonal-links";

const MARGIN = 150;

/** Regular rows/columns retain the same generation policy and upright cards. */
export function buildFamilyGenerationLayout(family: Family, focusPersonId: string | null, compactOthers = true, horizontal = false): FamilyRadialLayout {
  const pyramid = buildFamilyPyramidLayout(family, focusPersonId, compactOthers);
  const { nodeSize, centerPersonId } = pyramid;
  if (!pyramid.nodes.length) return { nodes: [], links: [], width: 0, height: 0, nodeSize, centerPersonId, rings: [] };
  const rows = new Map<number, FamilyTreeLayoutNode[]>();
  for (const node of pyramid.nodes) {
    const row = rows.get(node.y) ?? [];
    row.push(node);
    rows.set(node.y, row);
  }
  const ordered = [...rows.entries()].sort(([a], [b]) => a - b);
  const acrossSize = horizontal ? FAMILY_CARD_HEIGHT : FAMILY_CARD_WIDTH;
  const alongSize = horizontal ? FAMILY_CARD_WIDTH : FAMILY_CARD_HEIGHT;
  const acrossGap = acrossSize + 64;
  const alongGap = alongSize + 144;
  const across = (Math.max(...ordered.map(([, nodes]) => nodes.length)) - 1) * acrossGap + acrossSize + MARGIN * 2;
  const along = (ordered.length - 1) * alongGap + alongSize + MARGIN * 2;
  const nodes = ordered.flatMap(([, members], row) => [...members].sort((a, b) => a.x - b.x).map((node, column) => {
    const u = across / 2 + (column - (members.length - 1) / 2) * acrossGap;
    const v = MARGIN + alongSize / 2 + row * alongGap;
    return { ...node, x: horizontal ? v : u, y: horizontal ? u : v };
  }));
  return { nodes, links: buildOrthogonalFamilyLinks(nodes, family.relationships, horizontal), width: horizontal ? along : across, height: horizontal ? across : along,
    nodeSize, centerPersonId, rings: [], connectionStyle: "orthogonal", orientation: horizontal ? "horizontal" : "vertical" };
}
