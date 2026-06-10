"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type FamilyOnboardingFormProps = {
  defaultTitle: string;
  defaultSurname: string;
  defaultRegion: string;
  defaultDescription: string;
};

export function FamilyOnboardingForm({
  defaultTitle,
  defaultSurname,
  defaultRegion,
  defaultDescription,
}: FamilyOnboardingFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState("");
  const [formState, setFormState] = useState({
    title: defaultTitle,
    surname: defaultSurname,
    region: defaultRegion,
    description: defaultDescription,
  });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/families", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formState),
      });

      const result = (await response.json()) as {
        error?: string;
        slug?: string;
      };

      if (!response.ok || !result.slug) {
        throw new Error(result.error ?? "Не удалось создать семью.");
      }

      startTransition(() => {
        router.push(`/family/${result.slug}`);
        router.refresh();
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось создать семью.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <label className="form-field">
        <span>Название семьи</span>
        <input
          onChange={(event) =>
            setFormState((current) => ({ ...current, title: event.target.value }))
          }
          value={formState.title}
        />
      </label>
      <div className="form-grid">
        <label className="form-field">
          <span>Фамилия рода</span>
          <input
            onChange={(event) =>
              setFormState((current) => ({ ...current, surname: event.target.value }))
            }
            value={formState.surname}
          />
        </label>
        <label className="form-field">
          <span>Регион</span>
          <input
            onChange={(event) =>
              setFormState((current) => ({ ...current, region: event.target.value }))
            }
            value={formState.region}
          />
        </label>
      </div>
      <label className="form-field">
        <span>Описание</span>
        <textarea
          onChange={(event) =>
            setFormState((current) => ({ ...current, description: event.target.value }))
          }
          rows={4}
          value={formState.description}
        />
      </label>
      <div className="chip-row">
        <span className="status-chip active">Приватная семья</span>
        <span className="status-chip">Владелец получает роль owner</span>
        <span className="status-chip">После создания можно сразу добавлять людей</span>
      </div>

      {errorMessage ? <p className="form-message error">{errorMessage}</p> : null}

      <div className="form-actions">
        <button className="primary-button" disabled={isSubmitting || isPending} type="submit">
          {isSubmitting ? "Создаем..." : "Создать семью"}
        </button>
      </div>
    </form>
  );
}
