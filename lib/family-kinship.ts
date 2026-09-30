import type { Family, FamilyPerson } from "@/lib/types";

export type FamilyKinship = {
  label: string;
  // Includes the focus and target; every adjacent pair is a recorded edge.
  pathIds: string[];
  distance: number;
};

type Step = "parent" | "child" | "spouse" | "sibling";
type Rule = {
  steps: readonly Step[];
  label: (path: FamilyPerson[]) => string;
};

function genderLabel(person: FamilyPerson, male: string, female: string) {
  return person.gender === "male" ? male : female;
}

// Rule order is deliberate: direct family always wins over derived kinship.
// All rules contain at most three actual edges, never an inferred parent edge.
const RULES: readonly Rule[] = [
  { steps: ["parent"], label: (path) => genderLabel(path[1], "Отец", "Мать") },
  { steps: ["spouse"], label: (path) => genderLabel(path[1], "Муж", "Жена") },
  { steps: ["child"], label: (path) => genderLabel(path[1], "Сын", "Дочь") },
  { steps: ["sibling"], label: (path) => genderLabel(path[1], "Брат", "Сестра") },
  { steps: ["parent", "child"], label: (path) => genderLabel(path[2], "Брат", "Сестра") },
  { steps: ["parent", "parent"], label: (path) => genderLabel(path[2], "Дедушка", "Бабушка") },
  { steps: ["child", "child"], label: (path) => genderLabel(path[2], "Внук", "Внучка") },
  {
    steps: ["spouse", "parent"],
    label: (path) => path[1].gender === "female"
      ? genderLabel(path[2], "Тесть", "Тёща")
      : genderLabel(path[2], "Свёкор", "Свекровь"),
  },
  { steps: ["child", "spouse"], label: (path) => genderLabel(path[2], "Зять", "Невестка") },
  {
    steps: ["spouse", "sibling"],
    label: (path) => `${genderLabel(path[2], "Брат", "Сестра")} ${path[1].gender === "female" ? "жены" : "мужа"}`,
  },
  {
    steps: ["sibling", "spouse"],
    label: (path) => `${genderLabel(path[2], "Муж", "Жена")} ${path[1].gender === "female" ? "сестры" : "брата"}`,
  },
  { steps: ["parent", "sibling"], label: (path) => genderLabel(path[2], "Дядя", "Тётя") },
  { steps: ["sibling", "child"], label: (path) => genderLabel(path[2], "Племянник", "Племянница") },
  {
    steps: ["spouse", "parent", "child"],
    label: (path) => `${genderLabel(path[3], "Брат", "Сестра")} ${path[1].gender === "female" ? "жены" : "мужа"}`,
  },
  {
    steps: ["parent", "child", "spouse"],
    label: (path) => `${genderLabel(path[3], "Муж", "Жена")} ${path[2].gender === "female" ? "сестры" : "брата"}`,
  },
  { steps: ["parent", "parent", "child"], label: (path) => genderLabel(path[3], "Дядя", "Тётя") },
  { steps: ["parent", "child", "child"], label: (path) => genderLabel(path[3], "Племянник", "Племянница") },
];

/**
 * Derive supported labels relative to one active person without changing data.
 * Unknown, archived, unrelated and unsupported relatives are omitted, as is the
 * focus. Siblings may be recorded directly or share one recorded parent. Neither
 * a sibling's parent nor their other sibling is automatically a relative.
 * Multiple marriages
 * are all considered because the current schema has no active/former distinction.
 *
 * Paths are simple (no repeated IDs), have at most three edges, and are explored
 * in ID order. The first matching rule wins; equal-role paths use lexicographic
 * ID order, making both labels and witnesses independent of record ordering.
 */
export function getFamilyKinship(family: Family, focusPersonId: string): Map<string, FamilyKinship> {
  const people = new Map(family.people.filter((person) => !person.isArchived).map((person) => [person.id, person]));
  const result = new Map<string, FamilyKinship>();
  if (!people.has(focusPersonId)) return result;

  const neighbors: Record<Step, Map<string, Set<string>>> = {
    parent: new Map(), child: new Map(), spouse: new Map(), sibling: new Map(),
  };
  function connect(step: Step, from: string, to: string) {
    const ids = neighbors[step].get(from) ?? new Set<string>();
    ids.add(to);
    neighbors[step].set(from, ids);
  }
  for (const edge of family.relationships) {
    const from = edge.fromPersonId;
    const to = edge.toPersonId;
    if (from === to || !people.has(from) || !people.has(to)) continue;
    if (edge.type === "parent") {
      connect("parent", to, from);
      connect("child", from, to);
    } else if (edge.type === "spouse") {
      connect("spouse", from, to);
      connect("spouse", to, from);
    } else if (edge.type === "sibling") {
      connect("sibling", from, to);
      connect("sibling", to, from);
    }
  }
  const orderedNeighbors: Record<Step, Map<string, string[]>> = {
    parent: new Map(), child: new Map(), spouse: new Map(), sibling: new Map(),
  };
  for (const step of ["parent", "child", "spouse", "sibling"] as const) {
    for (const [id, ids] of neighbors[step]) orderedNeighbors[step].set(id, [...ids].sort());
  }

  for (const rule of RULES) {
    function walk(pathIds: string[]) {
      const distance = pathIds.length - 1;
      const targetId = pathIds[distance];
      if (distance === rule.steps.length) {
        if (!result.has(targetId)) {
          result.set(targetId, {
            label: rule.label(pathIds.map((id) => people.get(id)!)),
            pathIds,
            distance,
          });
        }
        return;
      }
      for (const nextId of orderedNeighbors[rule.steps[distance]].get(targetId) ?? []) {
        if (!pathIds.includes(nextId)) walk([...pathIds, nextId]);
      }
    }
    walk([focusPersonId]);
  }
  return result;
}
