"use client";

import Link from "next/link";
import { UserFamilySummary } from "@/lib/types";

type UserFamiliesProps = {
  families: UserFamilySummary[];
  currentUserName: string;
};

function getRoleLabel(role: UserFamilySummary["role"]) {
  if (role === "owner") {
    return "Владелец";
  }

  if (role === "admin") {
    return "Администратор";
  }

  if (role === "editor") {
    return "Редактор";
  }

  if (role === "member") {
    return "Участник";
  }

  return "Гость";
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

export function UserFamilies({ families, currentUserName }: UserFamiliesProps) {
  return (
    <section className="families-layout">
      <section className="families-hero">
        <div>
          <div className="eyebrow">Мои семьи</div>
          <h1>Семейные пространства {currentUserName}</h1>
          <p>
            Здесь собраны все семьи, где у тебя есть доступ: собственный архив рода,
            семейное пространство супругов и приглашенные ветки.
          </p>
        </div>
        <Link className="primary-button" href="/onboarding/family">
          Создать новую семью
        </Link>
      </section>

      {families.length ? (
        <section className="families-grid">
          {families.map((family) => (
            <article className="family-summary-card" key={family.id}>
              <div className="family-summary-top">
                <div>
                  <div className="eyebrow">Семья</div>
                  <h2>{family.title}</h2>
                </div>
                <span className="status-pill">{getRoleLabel(family.role)}</span>
              </div>
              <p>{family.description}</p>
              <div className="family-summary-meta">
                <span>{family.surname}</span>
                <span>{family.region}</span>
                <span>Обновлено {formatUpdatedAt(family.updatedAt)}</span>
              </div>
              <div className="metrics-grid family-summary-metrics">
                <div>
                  <strong>{family.stats.people}</strong>
                  <span>людей</span>
                </div>
                <div>
                  <strong>{family.stats.photos}</strong>
                  <span>фото</span>
                </div>
                <div>
                  <strong>{family.stats.audio}</strong>
                  <span>аудио</span>
                </div>
              </div>
              <div className="family-summary-actions">
                <Link className="accent-button" href={`/family/${family.slug}`}>
                  Открыть дерево
                </Link>
                <Link className="ghost-button" href={`/family/${family.slug}/journal`}>
                  Журнал
                </Link>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="archive-empty families-empty">
          <div className="eyebrow">Пока пусто</div>
          <h2>У тебя еще нет семейных пространств</h2>
          <p>
            Начни с создания первой семьи. После этого можно будет строить дерево,
            добавлять людей, фото и голосовые истории.
          </p>
          <Link className="primary-button" href="/onboarding/family">
            Создать первую семью
          </Link>
        </section>
      )}
    </section>
  );
}
