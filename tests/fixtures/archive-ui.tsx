import { useState } from "react";
import { createRoot } from "react-dom/client";
import FamilyError from "@/app/family/[slug]/error";
import FamilyLoading from "@/app/family/[slug]/loading";
import { FamilyArchive } from "@/components/family-archive";
import { FamilyApp } from "@/components/family-app";
import { FixtureNavigationProvider } from "./relationship-ui-navigation";
import type { Family, FamilyPerson } from "@/lib/types";

const people: FamilyPerson[] = Array.from({ length: 60 }, (_, index) => ({
  id: `p${String(index + 1).padStart(3, "0")}`, firstName: `Человек ${index + 1}`, lastName: "Проверочный",
  gender: "male", birthDate: "1950", birthPlace: "Вымышленный город", status: "living", isArchived: true,
  biography: "Вымышленная биография. Только данные тестового стенда.", timeline: [], stories: [], mediaAssets: [],
  media: { photos: 1, audio: 0, documents: 0 },
}));
const active = { ...people[0], id: "active", isArchived: false, detailsLoaded: false };
const family: Family = {
  id: "archive-ui", slug: "archive-ui", title: "Проверочный семейный архив", surname: "Проверочные", description: "", region: "", coverQuote: "",
  stats: { people: 1, photos: 0, audio: 0, stories: 0, contributors: 1 },
  people: [active], archivedPeople: [], relationships: [], auditLog: [], memberships: [], digitizationQueue: [],
};
// No request can escape to real auth, accounts, mail or storage.
window.fetch = async () => Response.json({ error: "Проверочная ошибка восстановления. Попробуйте снова." }, { status: 503 });

function Fixture() {
  const [mode, setMode] = useState("error");
  const [query, setQuery] = useState("");
  const [refreshes, setRefreshes] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const params = new URLSearchParams(query);
  const after = params.get("after");
  const before = params.get("before");
  const matching = people.filter((person) => after ? person.id > after : before ? person.id < before : true);
  const rows = before ? matching.slice(-24) : matching.slice(0, 24);
  const nextCursor = before ? rows.at(-1)?.id ?? before : matching.length > 24 ? rows.at(-1)!.id : null;
  const previousCursor = after ? rows[0]?.id ?? after : before && matching.length > 24 ? rows[0]!.id : null;

  return <FixtureNavigationProvider value={{
    query,
    router: { replace: () => {}, refresh: () => setRefreshes((value) => value + 1) },
    navigate: (href) => {
      const destination = new URL(href, window.location.origin);
      if (destination.origin !== window.location.origin || destination.pathname !== "/family/archive-ui/archive") return false;
      setQuery(destination.search.slice(1));
      return true;
    },
  }}>
    <aside className="note-box" style={{ margin: 16 }}>
      Вымышленные данные. Рабочая БД, почта и настоящие аккаунты не используются.
      <label className="form-field"><span>Экран проверки</span><select value={mode} onChange={(event) => setMode(event.target.value)}>
        <option value="error">Ошибка загрузки</option><option value="loading">Загрузка страницы</option>
        <option value="archive">Архив: 60 карточек</option><option value="pending">Карточка загружается</option>
      </select></label>
      <p role="status">Повторов загрузки: {refreshes}. Карточек на странице: {rows.length}.</p>
      {mode === "pending" ? <button type="button" className="ghost-button" onClick={() => setLoaded(true)}>Завершить загрузку карточки</button> : null}
    </aside>
    {mode === "error" ? <FamilyError error={new Error("synthetic-private-details-not-for-display")} reset={() => setMode("archive")} />
      : mode === "loading" ? <FamilyLoading />
        : mode === "pending" ? <FamilyApp initialFamily={{ ...family, people: [{ ...active, detailsLoaded: loaded }] }} initialFocusPersonId="active" canEdit section="people" />
          : <main className="page-shell"><FamilyArchive family={{ slug: family.slug, title: family.title, archivedPeople: rows }} backHref="/relationship-ui" canManage pagination={{ previousCursor, nextCursor, isFiltered: Boolean(after || before) }} /></main>}
  </FixtureNavigationProvider>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
