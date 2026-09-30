import Link from "next/link";
import { HeroTree } from "@/components/hero-tree";
import { SiteHeader } from "@/components/site-header";
import "./landing.css";

const chapters = [
  {
    number: "01",
    title: "Люди и поколения",
    label: "Семейное дерево",
    text: "Начните с себя. Добавляйте родителей, детей и близких — и смотрите, как отдельные имена становятся историей целой семьи.",
    className: "people",
  },
  {
    number: "02",
    title: "То, что хочется сберечь",
    label: "Фотографии и голоса",
    text: "Соберите фотографии и аудиозаписи в карточках родных. Чтобы любимое лицо и знакомый голос всегда были рядом.",
    className: "memories",
  },
  {
    number: "03",
    title: "Больше, чем даты",
    label: "Семейные истории",
    text: "Записывайте воспоминания, большие события и маленькие семейные традиции. Приглашайте близких дополнить ваш общий архив.",
    className: "stories",
  },
];

function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <main className="page-shell landing-page">
      <SiteHeader />

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-copy">
          <p className="landing-kicker"><span /> Нить, которая нас связывает</p>
          <h1 id="landing-title">Всё начинается<br />с <em>семьи.</em></h1>
          <p className="landing-intro">
            Сохраните тех, кто вам дорог.<br />
            Их лица, голоса и истории — в одном<br className="landing-desktop-break" /> живом семейном архиве.
          </p>
          <div className="landing-actions">
            <Link className="landing-main-link" href="/register">
              Создать свою семью <Arrow />
            </Link>
            <Link className="landing-demo-link" href="/demo">
              Посмотреть пример <span aria-hidden="true">↗</span>
            </Link>
          </div>
          <div className="landing-footnote">
            <span className="landing-footnote-mark" aria-hidden="true">*</span>
            <p>Большая история начинается<br />с одного имени. Вашего.</p>
          </div>
        </div>
        <HeroTree />
      </section>

      <section className="landing-chapters" id="features" aria-labelledby="chapters-title">
        <div className="landing-section-heading">
          <p className="landing-section-index">Что останется с вами</p>
          <h2 id="chapters-title">Не просто имена.<br /><em>Связь поколений.</em></h2>
          <p>Место, где семейные воспоминания<br />обретают свой дом.</p>
        </div>
        <div className="landing-chapter-grid">
          {chapters.map((chapter) => (
            <article className={`landing-chapter chapter-${chapter.className}`} key={chapter.number}>
              <div className="landing-chapter-top">
                <span className="landing-chapter-number">{chapter.number}</span>
                <span className="landing-chapter-label">{chapter.label}</span>
              </div>
              <div className="landing-chapter-art" aria-hidden="true">
                {chapter.className === "people" ? (
                  <svg viewBox="0 0 220 94" fill="none">
                    <path d="M66 26h88M110 26v42M50 68h120" stroke="currentColor" />
                    <circle cx="66" cy="26" r="17" fill="var(--landing-paper)" stroke="currentColor" />
                    <circle cx="154" cy="26" r="17" fill="var(--landing-paper)" stroke="currentColor" />
                    <circle cx="50" cy="68" r="13" fill="var(--landing-paper)" stroke="currentColor" />
                    <circle cx="110" cy="68" r="13" fill="var(--landing-red)" />
                    <circle cx="170" cy="68" r="13" fill="var(--landing-paper)" stroke="currentColor" />
                  </svg>
                ) : chapter.className === "memories" ? (
                  <svg viewBox="0 0 220 94" fill="none">
                    <path d="m42 22 55-7 7 57-55 7z" stroke="currentColor" />
                    <path d="m57 44 8-9 16 17 9-10 11 13" stroke="currentColor" />
                    <circle cx="82" cy="31" r="4" stroke="currentColor" />
                    <path d="M130 39v16m8-26v36m8-31v26m8-37v49m8-33v17m8-28v39m8-25v11m8-20v29" stroke="var(--landing-red)" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 220 94" fill="none">
                    <path d="M55 17h110v64H55zM67 33h63m-63 12h84m-84 12h76m-76 12h43" stroke="currentColor" />
                    <path d="m149 21 8-17 5 12 13 4-18 6-4 16z" fill="var(--landing-red)" />
                  </svg>
                )}
              </div>
              <h3>{chapter.title}</h3>
              <p>{chapter.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-invitation" aria-labelledby="invitation-title">
        <div className="landing-invitation-thread" aria-hidden="true">
          <svg viewBox="0 0 250 190" fill="none"><path d="M-5 130C75 129 210 101 226 42 239-8 138 4 158 64c17 51 70 78 121 80M158 65C126 13 59 32 76 76c19 53 131 81 176 87" stroke="currentColor" strokeWidth="1.5" /></svg>
        </div>
        <div>
          <p className="landing-section-index">Для тех, кто будет после нас</p>
          <h2 id="invitation-title">Оставьте семье<br />больше, чем <em>фамилию.</em></h2>
          <p>Первый человек, первая фотография, первая история.<br />Начните сегодня — продолжите вместе.</p>
        </div>
        <Link className="landing-invitation-link" href="/register">
          Начать семейную историю <Arrow />
        </Link>
      </section>

      <footer className="landing-footer">
        <Link href="/" className="landing-footer-brand" aria-label="Rodovo — главная">Rodovo<span>.</span></Link>
        <p>Помнить. Сохранять. Передавать.</p>
        <Link href="/demo">Заглянуть в демо-семью <span aria-hidden="true">↗</span></Link>
      </footer>
    </main>
  );
}
