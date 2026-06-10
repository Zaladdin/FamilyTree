import Link from "next/link";
import { Family } from "@/lib/types";

type FamilyJournalProps = {
  family: Family;
  backHref: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function FamilyJournal({ family, backHref }: FamilyJournalProps) {
  return (
    <section className="archive-layout">
      <div className="archive-intro">
        <div>
          <div className="eyebrow">Журнал изменений</div>
          <h1>{family.title}</h1>
          <p>
            Здесь фиксируются изменения по людям и архиву семьи: кто добавил
            человека, обновил карточку, загрузил медиа или переместил запись в архив.
          </p>
        </div>
        <div className="archive-actions">
          <Link className="ghost-button" href={backHref}>
            Вернуться в дерево
          </Link>
        </div>
      </div>

      {family.auditLog.length ? (
        <div className="journal-list">
          {family.auditLog.map((entry) => (
            <article className="journal-card" key={entry.id}>
              <div className="journal-meta">
                <span>{entry.actorName}</span>
                <span>{formatDate(entry.createdAt)}</span>
              </div>
              <strong>{entry.message}</strong>
              {entry.personName ? <p>Карточка: {entry.personName}</p> : null}
            </article>
          ))}
        </div>
      ) : (
        <section className="archive-empty">
          <div className="eyebrow">Пока пусто</div>
          <h2>Изменений еще не зафиксировано</h2>
          <p>После первых действий по дереву сюда начнут попадать события семьи.</p>
          <Link className="primary-button" href={backHref}>
            Открыть семейное дерево
          </Link>
        </section>
      )}
    </section>
  );
}
