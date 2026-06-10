import Link from "next/link";
import { HeroTree } from "@/components/hero-tree";
import { SiteHeader } from "@/components/site-header";

const valueCards = [
  {
    title: "Древо семьи",
    text: "Стройте ветви рода вокруг любого человека и переходите по поколениям без путаницы.",
  },
  {
    title: "Голоса памяти",
    text: "Прикрепляйте аудио с рассказами старших, чтобы история семьи звучала живым голосом.",
  },
  {
    title: "Облачный архив",
    text: "Храните фото, письма, документы и легенды рода в одном защищенном пространстве.",
  },
];

const featureList = [
  "Карточка человека с фото, историей, голосом и документами",
  "Автоматический расчет родства при добавлении новых членов семьи",
  "Совместное редактирование архива родственниками по приглашению",
  "Фокус на выбранном человеке: родители, дети, супруг и боковые ветви",
];

export default function HomePage() {
  return (
    <main className="page-shell">
      <SiteHeader />

      <section className="hero-grid">
        <div className="hero-copy">
          <div className="eyebrow">Платформа семейной памяти</div>
          <h1>Живое древо рода с историями, фотографиями и голосами семьи</h1>
          <p className="hero-text">
            Rodovo помогает превратить семейные воспоминания в цифровой архив:
            сохраняйте людей, связывайте поколения и передавайте истории дальше.
          </p>

          <div className="cta-row">
            <Link className="primary-button" href="/register">
              Начать создание семьи
            </Link>
            <Link className="secondary-button" href="/family/akhmedov?person=timur">
              Открыть демо-семью
            </Link>
          </div>

          <div className="hero-stats">
            <div>
              <strong>1 карточка</strong>
              <span>на каждого человека в роду</span>
            </div>
            <div>
              <strong>3 типа памяти</strong>
              <span>фото, документы, голос</span>
            </div>
            <div>
              <strong>0 дубликатов</strong>
              <span>по ФИО и дате рождения</span>
            </div>
          </div>
        </div>

        <HeroTree />
      </section>

      <section className="value-grid" id="features">
        {valueCards.map((card) => (
          <article className="value-card" key={card.title}>
            <h2>{card.title}</h2>
            <p>{card.text}</p>
          </article>
        ))}
      </section>

      <section className="story-panel">
        <div>
          <div className="eyebrow">Сценарий пользователя</div>
          <h2>Человек заходит на сайт, создает свою семью и собирает дерево по поколениям</h2>
        </div>
        <ul className="feature-list">
          {featureList.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
