import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { FamilyApp } from "@/components/family-app";
import { addPersonToFamily } from "@/lib/family-logic";
import { parseAddPersonInput, parseUpdatePersonInput, parseCreateStoryInput, parseUpdateStoryInput, parseStoryVersionInput } from "@/lib/request-validation";
import { addPeopleToFamily, parseBatchPersonInput } from "@/lib/family-batch";
import { addRelationshipToFamily, parseAddExistingRelationshipInput } from "@/lib/family-relationships";
import { applyAutomaticParenthood, formatParentInferenceWarnings } from "@/lib/family-parent-inference";
import { FixtureNavigationProvider } from "./relationship-ui-navigation";
import type { Family, FamilyPerson, FamilyRelationship, Story } from "@/lib/types";
import { buildPersonTimeline, createPersonTimelineEvents } from "@/lib/person-timeline";

type FixturePerson = FamilyPerson & { fixtureTimeline?: { label: string; kind: string }[] };

function person(id: string, firstName: string, gender: FamilyPerson["gender"], birthDate: string): FixturePerson {
  return {
    id, version: 0, firstName, lastName: "Проверочный", gender, birthDate, birthPlace: "Тестовый город",
    status: "living", isArchived: false, biography: "Вымышленный человек для проверки интерфейса.",
    timeline: [], fixtureTimeline: [{ label: "2010 - пользовательское воспоминание", kind: "custom" }],
    media: { photos: 0, audio: 0, documents: 0 }, mediaAssets: [],
    stories: id === "father" ? [{ id: "first-story", version: 0, title: "Семейная поездка", narrator: "Тестовый рассказчик", body: "Первый день поездки.\n\nВторой абзац воспоминания.", createdAt: "2026-01-01T00:00:00.000Z" }] : [],
  };
}

const initialFamily: Family = {
  id: "relationship-ui-fixture", slug: "relationship-ui-fixture", title: "Проверка связей — вымышленные данные",
  surname: "Проверочные", description: "Изолированная проверка", region: "Без базы данных", coverQuote: "",
  stats: { people: 4, photos: 0, audio: 0, stories: 0, contributors: 1 }, memberships: [], digitizationQueue: [],
  people: [person("father", "Отец", "male", "1966"), person("mother", "Мама", "female", "1972"), person("son", "Сын", "male", "1995"), person("daughter", "Дочь", "female", "2000")],
  archivedPeople: [], auditLog: [],
  relationships: [
    { type: "spouse", fromPersonId: "father", toPersonId: "mother" },
    { type: "parent", fromPersonId: "father", toPersonId: "son" },
    { type: "parent", fromPersonId: "father", toPersonId: "daughter" },
  ],
};

// Deliberately adversarial source order: the wife's parent couple comes first,
// but the husband is listed before his wife. Layout must follow family branches,
// not silently attach adult children to whichever parents happen to be nearby.
const marriageFamily: Family = {
  ...initialFamily,
  id: "two-family-marriage-fixture",
  title: "Две семьи и один брак — вымышленные данные",
  stats: { ...initialFamily.stats, people: 8 },
  people: [
    { ...person("wife-father", "Борис", "male", "1957"), lastName: "Лесной" },
    { ...person("wife-mother", "Раиса", "female", "1960"), lastName: "Лесная" },
    { ...person("husband-father", "Виктор", "male", "1956"), lastName: "Речной" },
    { ...person("husband-mother", "Нина", "female", "1959"), lastName: "Речная" },
    { ...person("husband", "Антон", "male", "1985"), lastName: "Речной" },
    { ...person("wife", "Вера", "female", "1987"), lastName: "Лесная" },
    { ...person("wife-brother", "Кирилл", "male", "1990"), lastName: "Лесной" },
    { ...person("husband-sister", "Ольга", "female", "1988"), lastName: "Речная" },
  ],
  relationships: [
    { type: "spouse", fromPersonId: "wife-father", toPersonId: "wife-mother" },
    { type: "spouse", fromPersonId: "husband-father", toPersonId: "husband-mother" },
    { type: "spouse", fromPersonId: "husband", toPersonId: "wife" },
    { type: "parent", fromPersonId: "wife-father", toPersonId: "wife" },
    { type: "parent", fromPersonId: "wife-mother", toPersonId: "wife" },
    { type: "parent", fromPersonId: "wife-father", toPersonId: "wife-brother" },
    { type: "parent", fromPersonId: "wife-mother", toPersonId: "wife-brother" },
    { type: "parent", fromPersonId: "husband-father", toPersonId: "husband" },
    { type: "parent", fromPersonId: "husband-mother", toPersonId: "husband" },
    { type: "parent", fromPersonId: "husband-father", toPersonId: "husband-sister" },
    { type: "parent", fromPersonId: "husband-mother", toPersonId: "husband-sister" },
  ],
};

type FixtureMode = "basic" | "marriage" | "empty";
const initialParams = new URLSearchParams(window.location.search);
const initialMode: FixtureMode = initialParams.get("fixture") === "marriage" ? "marriage" : initialParams.get("fixture") === "empty" ? "empty" : "basic";
const fixtureSources: Record<FixtureMode, Family> = {
  basic: initialFamily, marriage: marriageFamily,
  empty: { ...initialFamily, people: [], relationships: [], stats: { ...initialFamily.stats, people: 0 } },
};
function defaultPersonId(mode: FixtureMode) { return mode === "marriage" ? "husband" : mode === "empty" ? "" : "father"; }
function prepareFamily(family: Family): Family {
  const allPeople = [...family.people, ...family.archivedPeople.filter((person) => !family.people.some((item) => item.id === person.id))].map((item: FixturePerson) => {
    const fixtureTimeline = item.fixtureTimeline ?? createPersonTimelineEvents();
    return { ...item, fixtureTimeline, timeline: buildPersonTimeline(item, fixtureTimeline), stories: item.stories.map((story) => ({ ...story, version: story.version ?? 0 })) };
  });
  const relationships = family.relationships.map((edge) => ({ ...edge, id: edge.id ?? crypto.randomUUID(), version: edge.version ?? 0, origin: edge.origin ?? "manual" as const }));
  return {
    ...family, stats: { ...family.stats, stories: allPeople.filter((item) => !item.isArchived).reduce((count, item) => count + item.stories.length, 0) },
    people: allPeople.filter((person) => !person.isArchived).map((item) => ({ ...item, version: item.version ?? 0 })),
    archivedPeople: allPeople.filter((person) => person.isArchived), recordedRelationships: relationships,
    relationships: relationships.filter((edge) => [edge.fromPersonId, edge.toPersonId].every((id) => allPeople.some((person) => person.id === id && !person.isArchived))),
  };
}
const storageKey = `rodovo-synthetic-content-fixture:${initialMode}`;
function loadFixture() {
  try {
    const stored = sessionStorage.getItem(storageKey);
    if (stored) return JSON.parse(stored) as Family;
  } catch { /* Restricted storage still allows an in-memory preview. */ }
  return prepareFamily(structuredClone(fixtureSources[initialMode]));
}
let fixtureFamily = loadFixture();
let activeMode = initialMode;
function saveFixture(family: Family) {
  fixtureFamily = family;
  try { sessionStorage.setItem(`rodovo-synthetic-content-fixture:${activeMode}`, JSON.stringify(family)); } catch { /* This preview never persists real family data. */ }
}

function saveStory(personId: string, story: Story) {
  const people = fixtureFamily.people.map((item) => item.id !== personId ? item : {
    ...item,
    stories: [...item.stories.filter((entry) => entry.id !== story.id), ...(!story.deletedAt ? [story] : [])],
    deletedStories: [...(item.deletedStories ?? []).filter((entry) => entry.id !== story.id), ...(story.deletedAt ? [story] : [])],
  });
  saveFixture({ ...fixtureFamily, people, stats: { ...fixtureFamily.stats, stories: people.reduce((count, item) => count + item.stories.length, 0) } });
}
function mutationFamily(): Family {
  return { ...fixtureFamily, people: [...fixtureFamily.people, ...fixtureFamily.archivedPeople], relationships: fixtureFamily.recordedRelationships ?? fixtureFamily.relationships };
}
function clearSuppression(family: Family, edge: FamilyRelationship): Family {
  return edge.type !== "parent" ? family : { ...family, parentSuppressions: (family.parentSuppressions ?? []).filter((item) => item.fromPersonId !== edge.fromPersonId || item.toPersonId !== edge.toPersonId) };
}
let simulateNetworkFailure = false;
let simulateRelationshipConflict = false;
let simulateStoryConflict = false;
if (!initialParams.has("person")) initialParams.set("person", defaultPersonId(initialMode));

// Never delegate to the real browser fetch: every unrecognised operation fails closed.
window.fetch = async (input, init) => {
  if (simulateNetworkFailure) throw new TypeError("Failed to fetch");
  const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const prefix = "/api/family/relationship-ui-fixture/people";
  const editedPersonId = init?.method === "PATCH" ? path.match(new RegExp(`^${prefix}/([a-z0-9-]+)$`))?.[1] : undefined;
  const editedRelationship = (init?.method === "PATCH" || init?.method === "DELETE") ? path.match(new RegExp(`^${prefix}/([a-z0-9-]+)/relationships/([a-z0-9-]+)$`)) : null;
  const storyPath = path.match(new RegExp(`^${prefix}/([a-z0-9-]+)/stories(?:/([a-z0-9-]+))?(/restore)?$`));
  const storyAction = storyPath && ((!storyPath[2] && init?.method === "POST") || (storyPath[2] && !storyPath[3] && ["PATCH", "DELETE"].includes(init?.method ?? "")) || (storyPath[3] && init?.method === "POST")) ? storyPath : null;
  const isCreate = init?.method === "POST" && (path === prefix || path === `${prefix}/batch` || new RegExp(`^${prefix}/[a-z0-9-]+/relationships$`).test(path));
  if (typeof init?.body !== "string" || (!isCreate && !editedPersonId && !editedRelationship && !storyAction)) {
    return Response.json({ error: "Этот запрос запрещён в изолированной UI-проверке." }, { status: 400 });
  }
  try {
    const data: unknown = JSON.parse(init.body);
    if (storyAction) {
      const [, personId, storyId, restore] = storyAction;
      const owner = fixtureFamily.people.find((item) => item.id === personId);
      if (!owner) return Response.json({ error: "Человек не найден." }, { status: 404 });
      if (!storyId) {
        const story = { ...parseCreateStoryInput(data), id: crypto.randomUUID(), version: 0, createdAt: new Date().toISOString() };
        saveStory(personId, story);
        return Response.json({ personId, storyId: story.id, version: story.version, message: "История добавлена." });
      }
      let current = [...owner.stories, ...(owner.deletedStories ?? [])].find((item) => item.id === storyId);
      if (!current) return Response.json({ error: "История не найдена." }, { status: 404 });
      if (simulateStoryConflict) {
        current = { ...current, version: (current.version ?? 0) + 1, body: "Текст другого редактора.\n\nВторой абзац." };
        saveStory(personId, current);
        simulateStoryConflict = false;
      }
      const { expectedVersion } = parseStoryVersionInput(data);
      if (expectedVersion !== current.version) return Response.json({ error: "История уже изменена. Черновик сохранён. Скопируйте текст, закройте форму и откройте историю заново." }, { status: 409 });
      if (restore ? !current.deletedAt : current.deletedAt) return Response.json({ error: restore ? "История уже восстановлена." : "История удалена. Сначала восстановите её." }, { status: 409 });
      let next = current;
      if (init?.method === "PATCH") {
        const { expectedVersion: revision, ...changes } = parseUpdateStoryInput(data);
        next = { ...current, ...changes, version: revision + 1 };
      } else if (Boolean(current.deletedAt) !== !restore) {
        next = { ...current, version: expectedVersion + 1, deletedAt: restore ? undefined : new Date().toISOString() };
      }
      saveStory(personId, next);
      return Response.json({ personId, storyId, version: next.version, message: init?.method === "PATCH" ? "История обновлена." : restore ? "История восстановлена." : "История удалена. Её можно восстановить." });
    }
    if (editedRelationship) {
      const [, personId, relationshipId] = editedRelationship;
      let fullFamily = mutationFamily();
      let original = fullFamily.relationships.find((edge) => edge.id === relationshipId && (edge.fromPersonId === personId || edge.toPersonId === personId));
      if (!original) return Response.json({ error: "Связь не найдена." }, { status: 404 });
      if (simulateRelationshipConflict) {
        original = { ...original, version: (original.version ?? 0) + 1 };
        fullFamily = { ...fullFamily, relationships: fullFamily.relationships.map((edge) => edge.id === relationshipId ? original! : edge) };
        saveFixture(prepareFamily(fullFamily));
        simulateRelationshipConflict = false;
      }
      const expectedVersion = data && typeof data === "object" ? (data as Record<string, unknown>).expectedVersion : undefined;
      if (expectedVersion !== original.version) return Response.json({ error: "Родственная связь уже изменена. Черновик сохранён. Закройте форму и откройте связь заново, затем повторите нужные изменения." }, { status: 409 });
      let nextFamily: Family = { ...fullFamily, relationships: fullFamily.relationships.filter((edge) => edge.id !== relationshipId) };
      if (original.type === "parent") nextFamily.parentSuppressions = [...(nextFamily.parentSuppressions ?? []), { fromPersonId: original.fromPersonId, toPersonId: original.toPersonId }];
      if (init?.method === "DELETE") {
        saveFixture(prepareFamily(nextFamily));
        return Response.json({ personId, message: "Связь удалена. Карточки людей сохранены." });
      }
      const added = addRelationshipToFamily(nextFamily, personId, parseAddExistingRelationshipInput(data));
      if (!added.created) return Response.json({ error: "Эта связь уже существует." }, { status: 409 });
      const replacement = { ...added.relationship, id: relationshipId, version: (original.version ?? 0) + 1, origin: "manual" as const };
      nextFamily = clearSuppression({ ...added.family, relationships: [...nextFamily.relationships, replacement] }, replacement);
      const inferred = applyAutomaticParenthood(nextFamily, [replacement]);
      saveFixture(prepareFamily(inferred.family));
      return Response.json({ personId, message: "Связь изменена.", warnings: formatParentInferenceWarnings(inferred.warnings, nextFamily.people) });
    }
    if (editedPersonId) {
      const { expectedVersion, ...changes } = parseUpdatePersonInput(data);
      const currentPerson = fixtureFamily.people.find((item) => item.id === editedPersonId);
      if (!currentPerson) return Response.json({ error: "Человек не найден." }, { status: 404 });
      if (expectedVersion !== currentPerson.version) {
        return Response.json({ error: "Карточка изменена другим пользователем. Ваш черновик сохранён. Скопируйте введённые данные и откройте карточку заново." }, { status: 409 });
      }
      const updatedPerson = { ...currentPerson, ...changes, version: expectedVersion + 1 };
      updatedPerson.timeline = buildPersonTimeline(updatedPerson, (currentPerson as FixturePerson).fixtureTimeline ?? createPersonTimelineEvents());
      saveFixture({
        ...fixtureFamily,
        people: fixtureFamily.people.map((item) => item.id === editedPersonId ? updatedPerson : item),
      });
      return Response.json({ personId: editedPersonId, version: updatedPerson.version, message: "Карточка обновлена только в памяти UI-проверки." });
    }
    if (path === `${prefix}/batch`) {
      const result = addPeopleToFamily(mutationFamily(), parseBatchPersonInput(data));
      saveFixture(prepareFamily(result.family));
      return Response.json({ personId: result.people[0].id, personIds: result.people.map((item) => item.id), warnings: formatParentInferenceWarnings(result.warnings, result.family.people), message: `Добавлено людей: ${result.people.length}. Только в памяти UI-проверки.` });
    }
    if (path === prefix) {
      const result = addPersonToFamily(mutationFamily(), parseAddPersonInput(data));
      saveFixture(prepareFamily(result.family));
      return Response.json({ personId: result.person.id, warnings: formatParentInferenceWarnings(result.warnings, result.family.people), message: "Человек добавлен только в память UI-проверки." });
    }
    const personId = path.slice(prefix.length + 1, -"/relationships".length);
    const result = addRelationshipToFamily(mutationFamily(), personId, parseAddExistingRelationshipInput(data));
    const promoted = !result.created && result.relationship.origin !== "manual";
    const manual = { ...result.relationship, origin: "manual" as const, sourcePersonId: undefined,
      version: (result.relationship.version ?? 0) + (promoted ? 1 : 0) };
    const nextFamily = clearSuppression({ ...result.family, relationships: result.family.relationships.map((edge) =>
      edge === result.relationship ? manual : edge) }, manual);
    const inferred = applyAutomaticParenthood(nextFamily, [manual]);
    saveFixture(prepareFamily(inferred.family));
    return Response.json({ personId, warnings: formatParentInferenceWarnings(inferred.warnings, inferred.family.people), message: result.created ? "Связь добавлена только в память UI-проверки." : "Эта связь уже существует." });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Ошибка тестового запроса." }, { status: 400 });
  }
};

function Fixture() {
  const [mode, setMode] = useState<FixtureMode>(initialMode);
  const [query, setQuery] = useState(initialParams.toString());
  const [revision, setRevision] = useState(0);
  const [resetVersion, setResetVersion] = useState(0);
  const params = new URLSearchParams(query);
  const selectedPerson = fixtureFamily.people.find((item) => item.id === params.get("person"));
  useEffect(() => {
    const updateQuery = () => setQuery(window.location.search.slice(1));
    window.addEventListener("popstate", updateQuery);
    return () => window.removeEventListener("popstate", updateQuery);
  }, []);

  function changeQuery(nextQuery: string, addHistory = false) {
    setQuery(nextQuery);
    window.history[addHistory ? "pushState" : "replaceState"](null, "", `/relationship-ui${nextQuery ? `?${nextQuery}` : ""}`);
  }

  function resetFixture(nextMode = mode) {
    activeMode = nextMode;
    saveFixture(prepareFamily(structuredClone(fixtureSources[nextMode])));
    const nextParams = new URLSearchParams({ fixture: nextMode, person: defaultPersonId(nextMode) });
    setMode(nextMode);
    changeQuery(nextParams.toString());
    setRevision(0);
    setResetVersion((value) => value + 1);
  }

  function simulateConcurrentEdit(refresh: boolean) {
    if (!selectedPerson) return;
    const savedPerson = fixtureFamily.people.find((item) => item.id === selectedPerson.id);
    if (!savedPerson) return;
    const nextVersion = (savedPerson.version ?? 0) + 1;
    saveFixture({
      ...fixtureFamily,
      people: fixtureFamily.people.map((item) => item.id === selectedPerson.id
        ? { ...item, version: nextVersion, biography: `Изменение другого редактора, версия ${nextVersion}.` }
        : item),
    });
    // A remote edit need not push fresh props into the current browser. Both
    // paths retain FamilyApp's instance and its open draft.
    if (refresh) setRevision((value) => value + 1);
  }

  return <FixtureNavigationProvider value={{
    query,
    router: {
      replace: (href) => changeQuery(new URL(href, window.location.origin).search.slice(1)),
      refresh: () => setRevision((value) => value + 1),
    },
  }}>
    <aside className="note-box" style={{ margin: 20 }}>
      Только вымышленные данные в памяти и хранилище этой вкладки. База данных и настоящие аккаунты не используются. Перезагрузка сохраняет тестовые связи; сброс начинает сценарий заново.
      <div className="form-grid" style={{ marginTop: 12, maxWidth: 760 }}>
        <label className="form-field">
          <span>Сценарий проверки</span>
          <select value={mode} onChange={(event) => resetFixture(event.target.value as FixtureMode)}>
            <option value="basic">Мама без связи с детьми / миниформа</option>
            <option value="marriage">Две семьи / брак и родство</option>
            <option value="empty">Пустое дерево / несколько новых людей</option>
          </select>
        </label>
        <label className="form-field">
          <span>Открыть карточку (тест)</span>
          <select value={params.get("person") ?? ""} onChange={(event) => {
            const nextParams = new URLSearchParams(query);
            if (event.target.value) nextParams.set("person", event.target.value);
            else nextParams.delete("person");
            changeQuery(nextParams.toString(), true);
          }}>
            <option value="">Обзор без выбранной карточки</option>
            {fixtureFamily.people.map((item) => <option key={item.id} value={item.id}>{item.firstName} {item.lastName}</option>)}
          </select>
        </label>
      </div>
      <button className="ghost-button" type="button" onClick={() => resetFixture()}>Сбросить тестовые данные</button>
      <button className="ghost-button" type="button" disabled={!selectedPerson} onClick={() => simulateConcurrentEdit(true)}>Изменить карточку другим редактором (тест)</button>
      <button className="ghost-button" type="button" disabled={!selectedPerson} onClick={() => simulateConcurrentEdit(false)}>Чужое сохранение без обновления страницы (тест)</button>
      <label><input type="checkbox" onChange={(event) => { simulateNetworkFailure = event.target.checked; }} />Имитировать сетевую ошибку (тест)</label>
      <label><input type="checkbox" onChange={(event) => { simulateRelationshipConflict = event.target.checked; }} />Конфликт при следующем изменении связи (тест)</label>
      <label><input type="checkbox" onChange={(event) => { simulateStoryConflict = event.target.checked; }} />Конфликт при следующем изменении истории (тест)</label>
      <a href="/relationship-ui?fixture=basic&person=mother">Перейти к маме по ссылке (тест)</a>
      <span role="status" data-testid="fixture-counts"> Людей: {fixtureFamily.people.length}; связей: {fixtureFamily.relationships.length}; историй: {fixtureFamily.stats.stories}; обновлений: {revision}.</span>
      {selectedPerson ? <p>Сохранённая версия карточки: {selectedPerson.version}; биография: {selectedPerson.biography}</p> : null}
      {mode === "marriage" ? <p>Антон и Вера — супруги. Лесные — родители Веры и Кирилла; Речные — родители Антона и Ольги. Исходный порядок карточек специально перемешан для проверки линий.</p> : null}
    </aside>
    <FamilyApp key={`${mode}-${resetVersion}`} canEdit initialFamily={fixtureFamily} initialFocusPersonId={params.get("person")} />
    <details style={{ margin: 20 }}>
      <summary>Проверочные связи в памяти</summary>
      <pre>{JSON.stringify(fixtureFamily.relationships, null, 2)}</pre>
    </details>
  </FixtureNavigationProvider>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
