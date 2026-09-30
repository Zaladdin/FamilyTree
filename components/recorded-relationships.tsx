"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Family, FamilyPerson, FamilyRelationship } from "@/lib/types";
import { getPersonFullName } from "@/lib/family-utils";
import { requestFamilyAction, type FamilyActionResponse } from "@/lib/family-action-request";
import { ExistingRelationshipFields, type ExistingRelationshipKind } from "@/components/family-relationship-fields";
import { PersonFormDialog } from "@/components/person-form-dialog";

function describeRelationship(family: Family, relationship: FamilyRelationship) {
  const people = [...family.people, ...family.archivedPeople];
  const from = people.find((person) => person.id === relationship.fromPersonId);
  const to = people.find((person) => person.id === relationship.toPersonId);
  const fromName = from ? getPersonFullName(from) : "Неизвестный человек";
  const toName = to ? getPersonFullName(to) : "Неизвестный человек";
  if (relationship.type === "parent") return `${from?.gender === "female" ? "Мать" : "Отец"}: ${fromName}. Ребёнок: ${toName}.`;
  if (relationship.type === "spouse") return `Супруги: ${fromName} и ${toName}.`;
  return `Брат / сестра: ${fromName} и ${toName}.`;
}

type RelationshipCallbacks = {
  onSuccess: (result: FamilyActionResponse) => void;
  onRefresh: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  confirmDiscard?: () => boolean;
};

export function RelationshipChangeDialog({ family, subject, relationship, mode, onClose, onSuccess, onRefresh, onDirtyChange, onBusyChange, confirmDiscard }: RelationshipCallbacks & {
  family: Family;
  subject: FamilyPerson;
  relationship: FamilyRelationship;
  mode: "edit" | "delete";
  onClose: () => void;
}) {
  // Snapshot belongs to this open draft, not fresh props from a concurrent save.
  const [original] = useState(() => ({ ...relationship }));
  const [relativePersonId, setRelativePersonId] = useState(() => original.fromPersonId === subject.id ? original.toPersonId : original.fromPersonId);
  const [relationshipKind, setRelationshipKind] = useState<ExistingRelationshipKind>(() => original.type === "parent" && original.toPersonId === subject.id ? "child" : original.type);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const errorId = useId();
  const initialRelative = original.fromPersonId === subject.id ? original.toPersonId : original.fromPersonId;
  const initialKind = original.type === "parent" && original.toPersonId === subject.id ? "child" : original.type;
  const dirty = mode === "edit" && (relativePersonId !== initialRelative || relationshipKind !== initialKind);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function requestClose() {
    if (submitting.current) return;
    if (dirty && !(confirmDiscard ? confirmDiscard() : window.confirm("Есть несохранённые изменения. Выйти без сохранения?"))) return;
    onDirtyChange?.(false);
    onBusyChange?.(false);
    onClose();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (!original.id || original.version === undefined || !Number.isSafeInteger(original.version) || original.version < 0) {
      setError("Не удалось определить версию связи. Закройте форму и обновите страницу.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await requestFamilyAction(async () => {
        const response = await fetch(`/api/family/${family.slug}/people/${subject.id}/relationships/${original.id}`, {
          method: mode === "delete" ? "DELETE" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedVersion: original.version, ...(mode === "edit" ? { relativePersonId, relationshipKind } : {}) }),
        });
        if (response.status === 409) onRefresh();
        return response;
      }, mode === "delete" ? "Не удалось удалить связь." : "Не удалось изменить связь.");
      if (!result.personId) throw new Error("Не удалось подтвердить сохранение. Проверьте дерево перед повторной попыткой.");
      onDirtyChange?.(false);
      onBusyChange?.(false);
      onSuccess(result);
      onRefresh();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Не удалось сохранить связь. Черновик остался в форме.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <PersonFormDialog title={mode === "delete" ? "Удалить связь" : "Изменить связь"} description="Проверьте людей и направление связи перед сохранением." closeLabel="Закрыть изменение связи" busy={busy} onClose={requestClose}>
    <form className="form-stack person-mini-form" onSubmit={submit} aria-describedby={error ? errorId : undefined}>
      <p className="note-box"><strong>Сейчас записано:</strong> {describeRelationship(family, original)}</p>
      {mode === "edit" ? <>
        <ExistingRelationshipFields subject={subject} people={family.people} relativePersonId={relativePersonId} relationshipKind={relationshipKind} onRelativeChange={setRelativePersonId} onKindChange={setRelationshipKind} disabled={busy} />
        <p className="batch-person-hint">Старая связь будет заменена выбранной. Записанные связи с другими людьми сохранятся. Удалённая родительская связь не появится снова автоматически.</p>
      </> : <>
        <p className="note-box">Будет удалена только указанная связь. Карточки людей сохранятся. Остальные записанные связи сохранятся, а вычисляемое родство обновится.</p>
        {original.type === "parent" ? <p className="batch-person-hint">Эта родительская связь не появится снова автоматически, даже после обновления дерева. Чтобы восстановить её, добавьте её вручную.</p> : <p className="batch-person-hint">Уже записанные связи с детьми сохранятся. При необходимости удалите их отдельно.</p>}
      </>}
      {error ? <p className="form-message error" role="alert" ref={errorRef} tabIndex={-1} id={errorId}>{error}</p> : null}
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={busy || (mode === "edit" && !relativePersonId)}>{busy ? "Сохраняем…" : mode === "delete" ? "Удалить связь" : "Сохранить изменения"}</button>
        <button type="button" className="ghost-button" data-autofocus disabled={busy} onClick={requestClose}>Отмена</button>
      </div>
    </form>
  </PersonFormDialog>;
}

export function RecordedRelationships({ family, subject, onSuccess, onRefresh, onDirtyChange, onBusyChange, confirmDiscard, disabled = false }: RelationshipCallbacks & { family: Family; subject: FamilyPerson; disabled?: boolean }) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const restoreListFocus = useRef(false);
  const [editing, setEditing] = useState<{ relationship: FamilyRelationship; mode: "edit" | "delete" } | null>(null);
  useEffect(() => {
    if (!editing && restoreListFocus.current) {
      headingRef.current?.focus();
      restoreListFocus.current = false;
    }
  }, [editing]);
  const people = [...family.people, ...family.archivedPeople];
  const relationships = (family.recordedRelationships ?? family.relationships).filter((relationship) => relationship.fromPersonId === subject.id || relationship.toPersonId === subject.id);
  return <section aria-labelledby={headingId} className="form-stack">
    <h3 id={headingId} ref={headingRef} tabIndex={-1}>Связи человека</h3>
    <p className="batch-person-hint">Здесь записанные связи. Родство с остальной семьёй вычисляется по ним. Удалённую связь с родителем можно восстановить, добавив её вручную.</p>
    {!relationships.length ? <p>Записанных связей пока нет.</p> : <ul className="form-stack" style={{ listStyle: "none", padding: 0 }}>
      {relationships.map((relationship) => {
        const archived = people.some((person) => person.isArchived && (person.id === relationship.fromPersonId || person.id === relationship.toPersonId));
        const source = people.find((person) => person.id === relationship.sourcePersonId);
        const automatic = relationship.origin === "spouse" || relationship.origin === "sibling";
        const canChange = Boolean(relationship.id && relationship.version !== undefined);
        const description = describeRelationship(family, relationship);
        return <li className="note-box" key={relationship.id ?? `${relationship.type}:${relationship.fromPersonId}:${relationship.toPersonId}`}>
          <p>{description}</p>
          {automatic ? <p><strong>Добавлено автоматически</strong> · {relationship.origin === "spouse" ? "через супружество" : "через брата или сестру"}{source ? `: ${getPersonFullName(source)}` : ""}.</p> : <p>Добавлено вручную</p>}
          {archived ? <p><strong>В архиве</strong> · Для изменения сначала восстановите карточку родственника. Удалить связь можно сейчас.</p> : null}
          <div className="form-actions">
            <button className="secondary-button" type="button" disabled={disabled || !canChange || archived} aria-label={`Изменить связь: ${description}`} onClick={() => { if (!disabled) setEditing({ relationship, mode: "edit" }); }}>Изменить</button>
            <button className="ghost-button" type="button" disabled={disabled || !canChange} aria-label={`Удалить связь: ${description}`} onClick={() => { if (!disabled) setEditing({ relationship, mode: "delete" }); }}>Удалить связь</button>
          </div>
          {!canChange ? <p>Для изменения этой связи обновите страницу.</p> : null}
        </li>;
      })}
    </ul>}
    {editing ? <RelationshipChangeDialog family={family} subject={subject} relationship={editing.relationship} mode={editing.mode} onClose={() => setEditing(null)} onSuccess={(result) => { restoreListFocus.current = true; onSuccess(result); }} onRefresh={onRefresh} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} confirmDiscard={confirmDiscard} /> : null}
  </section>;
}
