"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Family } from "@/lib/types";
import { getPersonFullName } from "@/lib/family-utils";

type FamilyArchiveProps = {
  family: Family;
  backHref: string;
  canManage: boolean;
};

export function FamilyArchive({ family, backHref, canManage }: FamilyArchiveProps) {
  const [errorMessage, setErrorMessage] = useState("");
  const [pendingPersonId, setPendingPersonId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function handleRestorePerson(personId: string) {
    setErrorMessage("");
    setPendingPersonId(personId);

    try {
      const response = await fetch(
        `/api/family/${family.slug}/people/${personId}/restore`,
        {
          method: "POST",
        },
      );

      const result = (await response.json()) as {
        error?: string;
        personId?: string;
      };

      if (!response.ok || !result.personId) {
        throw new Error(result.error ?? "Не удалось восстановить человека.");
      }

      startTransition(() => {
        router.push(`/family/${family.slug}?person=${result.personId}`);
        router.refresh();
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Не удалось восстановить человека.",
      );
    } finally {
      setPendingPersonId(null);
    }
  }

  return (
    <section className="archive-layout">
      <div className="archive-intro">
        <div>
          <div className="eyebrow">Архив семьи</div>
          <h1>{family.title}</h1>
          <p>
            Здесь находятся люди, скрытые из активного дерева. Восстановление
            возвращает человека обратно в рабочую ветку без потери связей и медиа.
          </p>
        </div>
        <div className="archive-actions">
          <Link className="ghost-button" href={backHref}>
            Вернуться в дерево
          </Link>
        </div>
      </div>

      {errorMessage ? <div className="form-message error">{errorMessage}</div> : null}

      {family.archivedPeople.length ? (
        <div className="archive-grid">
          {family.archivedPeople.map((person) => {
            const isSubmitting = pendingPersonId === person.id || isPending;

            return (
              <article className="archive-card" key={person.id}>
                <div className="archive-card-header">
                  <div>
                    <div className="status-pill">В архиве</div>
                    <h2>{getPersonFullName(person)}</h2>
                  </div>
                  {canManage ? (
                    <button
                      className="primary-button"
                      disabled={isSubmitting}
                      onClick={() => handleRestorePerson(person.id)}
                      type="button"
                    >
                      {isSubmitting ? "Восстанавливаем..." : "Восстановить"}
                    </button>
                  ) : null}
                </div>

                <p>{person.biography}</p>

                <div className="archive-meta">
                  <span>{person.birthDate}</span>
                  <span>{person.birthPlace}</span>
                  <span>{person.status === "deceased" ? "Умер" : "Жив"}</span>
                </div>

                <div className="metrics-grid archive-metrics">
                  <div>
                    <strong>{person.media.photos}</strong>
                    <span>фото</span>
                  </div>
                  <div>
                    <strong>{person.media.audio}</strong>
                    <span>аудио</span>
                  </div>
                  <div>
                    <strong>{person.media.documents}</strong>
                    <span>документы</span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="archive-empty">
          <div className="eyebrow">Архив пуст</div>
          <h2>Сейчас все люди находятся в активном дереве</h2>
          <p>
            Когда ты архивируешь человека из карточки, он появится здесь и сможет
            быть восстановлен обратно.
          </p>
          <Link className="primary-button" href={backHref}>
            Открыть семейное дерево
          </Link>
        </section>
      )}
    </section>
  );
}
