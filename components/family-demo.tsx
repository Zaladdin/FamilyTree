"use client";

import { useState } from "react";
import { FamilyWorkspace } from "@/components/family-workspace";
import type { Family } from "@/lib/types";
import { normalizeTreeScale } from "@/lib/tree-viewport";

export function FamilyDemo({ family }: { family: Family }) {
  const [focusPersonId, setFocusPersonId] = useState<string | null>(
    family.people.find((person) => person.id === "timur")?.id ?? family.people[0]?.id ?? null,
  );
  const [canvasScale, setCanvasScale] = useState(0.78);

  return (
    <FamilyWorkspace
      family={family}
      focusPersonId={focusPersonId}
      canEdit={false}
      demo
      canvasScale={canvasScale}
      onFocusPerson={(personId) => {
        if (personId === null || family.people.some((person) => person.id === personId)) {
          setFocusPersonId(personId);
        }
      }}
      onZoomIn={() => setCanvasScale((current) => normalizeTreeScale(current + 0.1))}
      onZoomOut={() => setCanvasScale((current) => normalizeTreeScale(current - 0.1))}
      onResetZoom={() => setCanvasScale(1)}
      onScaleChange={(nextScale) => setCanvasScale(normalizeTreeScale(nextScale))}
    />
  );
}
