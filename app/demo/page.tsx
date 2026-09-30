import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FamilyDemo } from "@/components/family-demo";
import { SiteHeader } from "@/components/site-header";
import { getFamilyBySlug } from "@/lib/mock-data";
import type { Family, FamilyPerson, Story } from "@/lib/types";
import "./demo.css";

export const metadata: Metadata = {
  title: "Демонстрация семейного дерева — Rodovo",
  description:
    "Познакомьтесь с Rodovo на примере вымышленной семьи: исследуйте связи поколений и личные истории.",
  robots: { index: false, follow: true },
};

const demoStories: Partial<Record<string, Story[]>> = {
  timur: [
    {
      id: "demo-story-timur-sundays",
      title: "Воскресенья у бабушки",
      body:
        "По воскресеньям мы приходили к бабушке ещё до обеда. Из кухни пахло свежим хлебом, а на столе уже стояли маленькие стаканы для чая. Бабушка доставала коробку с фотографиями и каждый раз находила в знакомом снимке новую историю. Теперь я понимаю: мы собирались не только поесть. Мы учились помнить друг друга.",
      narrator: "Тимур Ахмедов",
      createdAt: "2026-08-16T10:00:00.000Z",
    },
  ],
  magomed: [
    {
      id: "demo-story-magomed-letters",
      title: "Письма из дома",
      body:
        "После переезда в Баку отец бережно хранил письма из Губы. Конверты лежали в деревянной коробке, перевязанные простой ниткой. В письмах было совсем немного новостей: кто женился, как уродились яблоки, кто передавал привет. Но отец всегда перечитывал их вслух. Так наш прежний дом продолжал жить рядом с нами.",
      narrator: "Ахмед Магомедов",
      createdAt: "2026-08-09T15:30:00.000Z",
    },
  ],
};

function normalizeDemoPerson(person: FamilyPerson): FamilyPerson {
  return {
    ...person,
    note: undefined,
    biography:
      person.id === "safiya"
        ? "Самая младшая в семье. С её появлением в доме снова звучат колыбельные, которые когда-то пела бабушка. Впереди у Сафии — первые шаги, знакомства с родными и целая жизнь собственных историй."
        : person.biography,
    timeline: person.id === "safiya" ? ["2026 — рождение в Баку"] : person.timeline,
    stories: demoStories[person.id] ?? person.stories,
    media: {
      photos: person.mediaAssets.filter((asset) => asset.type === "photo").length,
      audio: person.mediaAssets.filter((asset) => asset.type === "audio").length,
      documents: 0,
    },
    // The old fixture describes recordings that do not have playable files.
    memory: undefined,
  };
}

export default function DemoPage() {
  const sample = getFamilyBySlug("akhmedov");

  if (!sample) {
    notFound();
  }

  const people = sample.people.map(normalizeDemoPerson);
  const family: Family = {
    ...sample,
    people,
    archivedPeople: sample.archivedPeople.map(normalizeDemoPerson),
    description: "Четыре поколения одной вымышленной семьи — от Губы до Баку.",
    stats: {
      people: people.length,
      photos: people.reduce((total, person) => total + person.media.photos, 0),
      audio: people.reduce((total, person) => total + person.media.audio, 0),
      stories: people.reduce((total, person) => total + person.stories.length, 0),
      contributors: sample.memberships.length,
    },
    digitizationQueue: [],
    auditLog: [],
  };

  return (
    <main className="page-shell demo-page">
      <SiteHeader compact />
      <section className="demo-notice" aria-labelledby="demo-notice-title">
        <div className="demo-notice-copy">
          <span className="demo-notice-label">Открытый пример</span>
          <h2 id="demo-notice-title">Знакомство с семейным архивом</h2>
          <p>
            Все имена и истории здесь вымышлены. Выберите человека, чтобы изучить
            его ветвь. Демонстрация работает без регистрации и не сохраняет изменения.
          </p>
        </div>
        <Link className="accent-button demo-notice-action" href="/register">
          Создать своё дерево <span aria-hidden="true">↗</span>
        </Link>
      </section>
      <FamilyDemo family={family} />
    </main>
  );
}
