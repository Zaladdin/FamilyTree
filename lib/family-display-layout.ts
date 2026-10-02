import type { Family } from "@/lib/types";
import { getFamilyKinship } from "@/lib/family-kinship";
import { buildFamilyRadialLayout, type FamilyRadialLayout } from "@/lib/family-radial-layout";
import { buildFamilyPyramidLayout, type FamilyPyramidLayout } from "@/lib/family-pyramid-layout";
import { buildFamilyGenerationLayout } from "@/lib/family-generation-layout";

export type FamilyDisplayMode = "radial" | "pyramid" | "generations" | "horizontal";

/** View policy stays separate from geometry: names never create stored edges. */
export function buildFamilyDisplayLayout(
  family: Family,
  focusPersonId: string | null,
  hideOthers = false,
  kinship = getFamilyKinship(family, focusPersonId ?? ""),
  displayMode: FamilyDisplayMode = "radial",
): FamilyRadialLayout | FamilyPyramidLayout {
  const focus = family.people.find((person) => person.id === focusPersonId);
  let visibleFamily = family;
  if (hideOthers && focus) {
    // Keep the recorded intermediate people too: an in-law must not become an
    // isolated card after their spouse / shared ancestor has been filtered out.
    const visible = new Set([focus.id, ...[...kinship.values()].flatMap((relation) => relation.pathIds)]);
    visibleFamily = {
      ...family,
      people: family.people.filter((person) => visible.has(person.id)),
      relationships: family.relationships.filter((relation) => visible.has(relation.fromPersonId) && visible.has(relation.toPersonId)),
    };
  }
  const layout = displayMode === "pyramid"
    ? buildFamilyPyramidLayout(visibleFamily, focus?.id ?? null, !hideOthers)
    : displayMode === "generations" || displayMode === "horizontal"
      ? buildFamilyGenerationLayout(visibleFamily, focus?.id ?? null, !hideOthers, displayMode === "horizontal")
    : buildFamilyRadialLayout(visibleFamily, focus?.id ?? null, !hideOthers);
  return {
    ...layout,
    nodes: layout.nodes.map((node) => ({
      ...node,
      isFocus: node.person.id === focus?.id,
      role: focus ? kinship.get(node.person.id)?.label ?? "" : "",
    })),
  };
}
