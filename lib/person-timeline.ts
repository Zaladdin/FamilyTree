type LifeDates = { birthDate: string; deathDate?: string | null; status: "living" | "deceased" };
type TimelineRow = { label: string; kind?: string };

/** Stored custom events retain their order and text; system dates come from the card. */
export function buildPersonTimeline(person: LifeDates, events: readonly TimelineRow[]): string[] {
  return [
    `${person.birthDate} - рождение`,
    ...events.filter((event) => !event.kind || event.kind === "custom").map((event) => event.label),
    ...(person.status === "deceased" && person.deathDate ? [`${person.deathDate} - смерть`] : []),
  ];
}

export function createPersonTimelineEvents() {
  return [{ label: `${new Date().getFullYear()} - добавлен(а) в цифровое дерево семьи`, order: 0, kind: "custom" as const }];
}
