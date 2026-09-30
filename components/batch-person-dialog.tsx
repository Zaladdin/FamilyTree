"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MAX_BATCH_PEOPLE, type BatchPersonEntry } from "@/lib/family-batch";
import { type AddPersonInput, type AddRelationshipKind } from "@/lib/family-logic";
import type { Family, Gender } from "@/lib/types";
import { PersonFormDialog } from "@/components/person-form-dialog";
import { PersonLifeFields } from "@/components/person-life-fields";
import { AdditionalRelationshipsFields, AutomaticParenthoodNotice } from "@/components/family-relationship-fields";

export function createBatchPersonDraft(clientId: string, relativePersonId: string): BatchPersonEntry {
  return {
    clientId, firstName: "", lastName: "", middleName: "", gender: "female",
    birthDate: "", birthPlace: "", biography: "", status: "living", deathDate: "",
    relationshipKind: "child", relativePersonId, sharedChildIds: [], additionalRelationships: [],
  };
}

export function removeBatchPersonDraft(people: BatchPersonEntry[], clientId: string): BatchPersonEntry[] {
  return people.filter((person) => person.clientId !== clientId).map((person) => ({
    ...person,
    ...(person.relativeClientId === clientId ? { relativeClientId: undefined, relativePersonId: "", sharedChildIds: [] } : {}),
    additionalRelationships: (person.additionalRelationships ?? []).map((relationship) => relationship.relativeClientId === clientId
      ? { ...relationship, relativeClientId: undefined, relativePersonId: "" }
      : relationship),
  }));
}

type BatchPersonDialogProps = {
  family: Family;
  focusPersonId: string | null;
  initialPerson?: AddPersonInput;
  initialDirty?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  busy: boolean;
  errorMessage: string;
  onClose: () => void;
  onSubmit: (people: BatchPersonEntry[]) => Promise<void>;
};

export function BatchPersonDialog({ family, focusPersonId, initialPerson, initialDirty = false, onDirtyChange, busy, errorMessage, onClose, onSubmit }: BatchPersonDialogProps) {
  const instanceId = useId();
  const sequence = useRef(2);
  const submitting = useRef(false);
  const firstInputs = useRef(new Map<string, HTMLInputElement>());
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [validationError, setValidationError] = useState("");
  const error = validationError || errorMessage;
  const existingPeople = family.people.filter((person) => !person.isArchived);
  const initialRelativeId = existingPeople.some((person) => person.id === focusPersonId) ? focusPersonId! : "";
  const [people, setPeople] = useState<BatchPersonEntry[]>(() => {
    const first = { ...createBatchPersonDraft(`${instanceId}-1`, initialRelativeId), ...initialPerson, clientId: `${instanceId}-1` };
    const second = createBatchPersonDraft(`${instanceId}-2`, initialRelativeId);
    if (!existingPeople.length) second.relativeClientId = first.clientId;
    return [first, second];
  });
  const [initialDraft] = useState(() => JSON.stringify(people));
  const dirty = initialDirty || JSON.stringify(people) !== initialDraft;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (focusTarget) {
      firstInputs.current.get(focusTarget)?.focus();
      setFocusTarget(null);
    }
  }, [focusTarget]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function updatePerson(clientId: string, changes: Partial<BatchPersonEntry>) {
    if (busy || submitting.current) return;
    setPeople((current) => current.map((person) => person.clientId === clientId ? { ...person, ...changes } : person));
    setValidationError("");
  }

  function appendPerson() {
    if (busy || submitting.current || people.length >= MAX_BATCH_PEOPLE) return;
    const clientId = `${instanceId}-${++sequence.current}`;
    const next = createBatchPersonDraft(clientId, initialRelativeId);
    setPeople((current) => [...current, next]);
    setNotice("Новая карточка добавлена. Заполните данные и выберите родственника.");
    setFocusTarget(clientId);
  }

  function removePerson(clientId: string) {
    if (busy || submitting.current || people.length <= 1) return;
    const index = people.findIndex((person) => person.clientId === clientId);
    const hasDependent = people.some((person) => person.relativeClientId === clientId || person.additionalRelationships?.some((relationship) => relationship.relativeClientId === clientId));
    const remaining = removeBatchPersonDraft(people, clientId);
    setPeople(remaining);
    setNotice(hasDependent
      ? "Карточка удалена. Для связанных с ней новых людей выберите родственника заново."
      : "Карточка удалена из списка добавления.");
    setFocusTarget(remaining[Math.min(index, remaining.length - 1)].clientId);
    setValidationError("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || submitting.current) return;
    const invalidIndex = people.findIndex((person, index) => {
      if (!existingPeople.length && index === 0) return false;
      return [person, ...(person.additionalRelationships ?? [])].some((relationship) => relationship.relativeClientId
        ? !people.slice(0, index).some((earlier) => earlier.clientId === relationship.relativeClientId)
        : !existingPeople.some((existing) => existing.id === relationship.relativePersonId));
    });
    if (invalidIndex >= 0) {
      setValidationError(`Человек ${invalidIndex + 1}: выберите родственника, с которым нужно связать карточку.`);
      return;
    }
    setValidationError("");
    submitting.current = true;
    try {
      await onSubmit(people.map((person, index) => ({
        ...person,
        ...(!existingPeople.length && index === 0 ? { relativePersonId: "", relativeClientId: undefined } : {}),
        deathDate: person.status === "deceased" ? person.deathDate : "",
        sharedChildIds: [],
        additionalRelationships: !existingPeople.length && index === 0 ? [] : person.additionalRelationships ?? [],
      })));
    } finally {
      submitting.current = false;
    }
  }

  return <PersonFormDialog
    title="Добавить нескольких человек"
    description={`До ${MAX_BATCH_PEOPLE} человек за один раз. Для каждого укажите данные и связь с семьёй. Все карточки сохраняются вместе.`}
    busy={busy}
    onClose={onClose}
  >
    <form className="form-stack person-mini-form batch-person-form" onSubmit={submit} aria-describedby={error ? `${instanceId}-error` : undefined}>
      {people.map((person, index) => {
        const cardId = `${instanceId}-${person.clientId}`;
        const hasRelative = existingPeople.length > 0 || index > 0;
        const earlierPeople = people.slice(0, index);
        const relativeValue = person.relativeClientId ? `draft:${person.relativeClientId}` : person.relativePersonId ? `existing:${person.relativePersonId}` : "";
        return <fieldset className="batch-person-card" key={person.clientId} disabled={busy}>
          <legend>Человек {index + 1}</legend>
          <div className="batch-person-card__heading">
            <p>{person.firstName.trim() || "Новая карточка"}{person.lastName.trim() ? ` ${person.lastName}` : ""}</p>
            <button type="button" className="ghost-button" disabled={busy || people.length === 1} onClick={() => removePerson(person.clientId)} aria-label={`Удалить карточку ${index + 1}`}>Убрать</button>
          </div>
          <div className="form-grid">
            <label className="form-field" htmlFor={`${cardId}-firstName`}><span>Имя</span>
              <input id={`${cardId}-firstName`} name={`${person.clientId}.firstName`} data-autofocus={index === 0 ? true : undefined} ref={(element) => { if (element) firstInputs.current.set(person.clientId, element); else firstInputs.current.delete(person.clientId); }} required value={person.firstName} onChange={(event) => updatePerson(person.clientId, { firstName: event.target.value })} />
            </label>
            <label className="form-field" htmlFor={`${cardId}-lastName`}><span>Фамилия</span>
              <input id={`${cardId}-lastName`} name={`${person.clientId}.lastName`} required value={person.lastName} onChange={(event) => updatePerson(person.clientId, { lastName: event.target.value })} />
            </label>
          </div>
          <label className="form-field" htmlFor={`${cardId}-middleName`}><span>Отчество</span>
            <input id={`${cardId}-middleName`} name={`${person.clientId}.middleName`} value={person.middleName ?? ""} onChange={(event) => updatePerson(person.clientId, { middleName: event.target.value })} />
          </label>
          <div className="form-grid">
            <label className="form-field" htmlFor={`${cardId}-gender`}><span>Пол</span>
              <select id={`${cardId}-gender`} className="form-select" value={person.gender} onChange={(event) => updatePerson(person.clientId, { gender: event.target.value as Gender })}><option value="male">Мужской</option><option value="female">Женский</option></select>
            </label>
            <label className="form-field" htmlFor={`${cardId}-birthDate`}><span>Дата рождения</span>
              <input id={`${cardId}-birthDate`} name={`${person.clientId}.birthDate`} required placeholder="Год или ДД.ММ.ГГГГ" value={person.birthDate} onChange={(event) => updatePerson(person.clientId, { birthDate: event.target.value })} />
            </label>
          </div>
          <label className="form-field" htmlFor={`${cardId}-birthPlace`}><span>Место рождения</span>
            <input id={`${cardId}-birthPlace`} name={`${person.clientId}.birthPlace`} required value={person.birthPlace} onChange={(event) => updatePerson(person.clientId, { birthPlace: event.target.value })} />
          </label>
          <PersonLifeFields status={person.status ?? "living"} deathDate={person.deathDate ?? ""} onChange={(life) => updatePerson(person.clientId, life)} />
          {hasRelative ? <div className="form-grid">
            <label className="form-field" htmlFor={`${cardId}-relationship`}><span>Кем приходится</span>
              <select id={`${cardId}-relationship`} className="form-select" value={person.relationshipKind} onChange={(event) => updatePerson(person.clientId, { relationshipKind: event.target.value as AddRelationshipKind, sharedChildIds: [] })}>
                <option value="child">Ребёнок</option><option value="parent">Родитель</option><option value="spouse">Супруг / супруга</option><option value="sibling">Брат / сестра</option>
              </select>
            </label>
            <label className="form-field" htmlFor={`${cardId}-relative`}><span>С кем связать</span>
              <select id={`${cardId}-relative`} className="form-select" value={relativeValue} required onChange={(event) => {
                const value = event.target.value;
                updatePerson(person.clientId, value.startsWith("draft:")
                  ? { relativeClientId: value.slice(6), relativePersonId: "", sharedChildIds: [] }
                  : { relativeClientId: undefined, relativePersonId: value.slice(9), sharedChildIds: [] });
              }}>
                <option disabled value="">Выберите родственника</option>
                {existingPeople.length ? <optgroup label="В дереве">{existingPeople.map((relative) => <option key={relative.id} value={`existing:${relative.id}`}>{[relative.firstName, relative.middleName, relative.lastName].filter(Boolean).join(" ")}</option>)}</optgroup> : null}
                {earlierPeople.length ? <optgroup label="Из этого списка">{earlierPeople.map((relative, relativeIndex) => <option key={relative.clientId} value={`draft:${relative.clientId}`}>Человек {relativeIndex + 1} — {[relative.firstName, relative.lastName].filter(Boolean).join(" ") || "новая карточка"}</option>)}</optgroup> : null}
              </select>
            </label>
          </div> : <p className="batch-person-hint">С этого человека начнётся дерево.</p>}
          {hasRelative ? <AutomaticParenthoodNotice relationshipKind={person.relationshipKind} /> : null}
          {hasRelative ? <AdditionalRelationshipsFields people={existingPeople} earlierPeople={earlierPeople} relationships={person.additionalRelationships ?? []} disabled={busy} onChange={(additionalRelationships) => updatePerson(person.clientId, { additionalRelationships })} /> : null}
          <details className="person-mini-form__details"><summary>Дополнительно <span>биография</span></summary><div>
            <label className="form-field" htmlFor={`${cardId}-biography`}><span>Краткая биография</span>
              <textarea id={`${cardId}-biography`} name={`${person.clientId}.biography`} rows={3} value={person.biography ?? ""} onChange={(event) => updatePerson(person.clientId, { biography: event.target.value })} />
            </label>
          </div></details>
        </fieldset>;
      })}
      <button className="secondary-button batch-person-append" type="button" disabled={busy || people.length >= MAX_BATCH_PEOPLE} onClick={appendPerson}>+ Ещё человек</button>
      <p className="batch-person-hint">{people.length} из {MAX_BATCH_PEOPLE} карточек. Нового родственника можно связать с человеком в дереве или с предыдущей карточкой в этом списке.</p>
      <p className="batch-person-hint" role="status" aria-live="polite">{notice}</p>
      {error ? <p className="form-message error" role="alert" ref={errorRef} tabIndex={-1} id={`${instanceId}-error`}>{error}</p> : null}
      <div className="form-actions">
        <button className="primary-button" disabled={busy} type="submit">{busy ? "Сохраняем…" : `Добавить всех (${people.length})`}</button>
        <button className="ghost-button" disabled={busy} type="button" onClick={onClose}>Отмена</button>
      </div>
    </form>
  </PersonFormDialog>;
}
