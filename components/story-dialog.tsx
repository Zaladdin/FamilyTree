"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FamilyPerson, Story } from "@/lib/types";
import { getPersonFullName } from "@/lib/family-utils";
import { requestFamilyAction, type FamilyActionResponse } from "@/lib/family-action-request";
import { PersonFormDialog } from "@/components/person-form-dialog";

export type StoryDialogMode = "create" | "edit" | "delete" | "restore";

export function StoryChangeDialog({ slug, subject, story, mode, onClose, onSuccess, onRefresh, onDirtyChange, onBusyChange }: {
  slug: string;
  subject: FamilyPerson;
  story?: Story;
  mode: StoryDialogMode;
  onClose: () => void;
  onSuccess: (result: FamilyActionResponse) => void;
  onRefresh: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  // The revision and original values belong to this open draft, even after a refresh.
  const [original] = useState(() => story ? { ...story } : undefined);
  const [initial] = useState(() => ({ title: original?.title ?? "", narrator: original?.narrator ?? "", body: original?.body ?? "" }));
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const instanceId = useId();
  const editable = mode === "create" || mode === "edit";
  const dirty = editable && (draft.title !== initial.title || draft.body !== initial.body || draft.narrator !== initial.narrator);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (mode !== "create" && (!original?.id || !Number.isSafeInteger(original.version) || original.version! < 0)) {
      setError("Не удалось определить версию истории. Скопируйте черновик, закройте форму и обновите страницу.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const base = `/api/family/${slug}/people/${subject.id}/stories`;
      const endpoint = mode === "create" ? base : `${base}/${original!.id}${mode === "restore" ? "/restore" : ""}`;
      const result = await requestFamilyAction(async () => {
        const response = await fetch(endpoint, {
          method: mode === "edit" ? "PATCH" : mode === "delete" ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...(editable ? draft : {}), ...(mode !== "create" ? { expectedVersion: original!.version } : {}) }),
        });
        if (response.status === 409) onRefresh();
        return response;
      }, "Не удалось сохранить историю.");
      if (!result.personId || !result.storyId || result.version === undefined) {
        throw new Error("Не удалось подтвердить сохранение. Черновик остался в форме. Проверьте результат перед повторной отправкой.");
      }
      onDirtyChange(false);
      onSuccess(result);
      onRefresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Не удалось сохранить историю. Черновик остался в форме.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const title = mode === "create" ? "Добавить историю или легенду" : mode === "edit" ? "Редактировать историю" : mode === "delete" ? "Удалить историю" : "Восстановить историю";
  const submitLabel = mode === "create" ? "Добавить историю" : mode === "edit" ? "Сохранить изменения" : mode === "delete" ? "Удалить историю" : "Восстановить историю";
  return <PersonFormDialog title={title} description={`Карточка: ${getPersonFullName(subject)}.`} busy={busy} closeLabel="Закрыть форму истории" onClose={onClose}>
    <form className="form-stack person-mini-form" onSubmit={submit} aria-describedby={error ? `${instanceId}-error` : undefined}>
      {editable ? <fieldset className="story-form-fields form-stack" disabled={busy}>
        <label className="form-field" htmlFor={`${instanceId}-title`}><span>Заголовок</span>
          <input id={`${instanceId}-title`} name="title" required maxLength={160} data-autofocus value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
        </label>
        <label className="form-field" htmlFor={`${instanceId}-narrator`}><span>Рассказчик</span>
          <input id={`${instanceId}-narrator`} name="narrator" maxLength={160} placeholder="Кто рассказал эту историю" value={draft.narrator} onChange={(event) => setDraft((current) => ({ ...current, narrator: event.target.value }))} />
        </label>
        <label className="form-field" htmlFor={`${instanceId}-body`}><span>Текст истории</span>
          <textarea id={`${instanceId}-body`} name="body" required maxLength={12000} rows={9} value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} />
        </label>
        <p className="batch-person-hint">Абзацы и переносы строк сохранятся. История появится в карточке этого человека.</p>
      </fieldset> : <>
        <p className="note-box"><strong>{original?.title}</strong></p>
        <p>{mode === "delete" ? "История будет скрыта из карточки. Её можно восстановить в разделе «Удалённые истории»." : "История вернётся в карточку человека с сохранённым текстом и рассказчиком."}</p>
      </>}
      {error ? <p ref={errorRef} tabIndex={-1} id={`${instanceId}-error`} className="form-message error" role="alert">{error}</p> : null}
      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={busy}>{busy ? "Сохраняем…" : submitLabel}</button>
        <button className="ghost-button" type="button" disabled={busy} data-autofocus={!editable ? true : undefined} onClick={onClose}>Отмена</button>
      </div>
    </form>
  </PersonFormDialog>;
}
