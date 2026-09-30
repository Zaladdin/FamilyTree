"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FamilyPerson } from "@/lib/types";
import { getPersonFullName } from "@/lib/family-utils";
import type { PersonRelationshipInput } from "@/lib/family-logic";

export type ExistingRelationshipKind = "parent" | "child" | "spouse" | "sibling";

export function AdditionalRelationshipsFields({
  people, earlierPeople = [], relationships, onChange, disabled = false,
}: {
  people: FamilyPerson[];
  earlierPeople?: { clientId: string; firstName: string; lastName: string }[];
  relationships: PersonRelationshipInput[];
  onChange: (relationships: PersonRelationshipInput[]) => void;
  disabled?: boolean;
}) {
  const instanceId = useId();
  const sequence = useRef(relationships.length);
  const [rowIds, setRowIds] = useState(() => relationships.map((_, index) => `${instanceId}-${index + 1}`));
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const selectRefs = useRef(new Map<string, HTMLSelectElement>());
  const appendRef = useRef<HTMLButtonElement>(null);
  const candidates = people.filter((person) => !person.isArchived);

  useEffect(() => {
    if (!focusTarget) return;
    if (focusTarget === "append") appendRef.current?.focus();
    else selectRefs.current.get(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  function update(index: number, change: Partial<PersonRelationshipInput>) {
    if (disabled) return;
    onChange(relationships.map((relationship, position) => position === index ? { ...relationship, ...change } : relationship));
  }

  function append() {
    if (disabled || relationships.length >= 9) return;
    const rowId = `${instanceId}-${++sequence.current}`;
    setRowIds((current) => [...current, rowId]);
    onChange([...relationships, { relationshipKind: "child", relativePersonId: "" }]);
    setFocusTarget(rowId);
  }

  function remove(index: number) {
    if (disabled) return;
    const remainingIds = rowIds.filter((_, position) => position !== index);
    setRowIds(remainingIds);
    onChange(relationships.filter((_, position) => position !== index));
    setFocusTarget(remainingIds[Math.min(index, remainingIds.length - 1)] ?? "append");
  }

  return <div className="additional-relationships">
    {relationships.map((relationship, index) => {
      const rowId = rowIds[index];
      const relativeValue = relationship.relativeClientId ? `draft:${relationship.relativeClientId}` : relationship.relativePersonId ? `existing:${relationship.relativePersonId}` : "";
      return <fieldset className="additional-relationship" key={rowId} disabled={disabled}>
        <legend>Связь {index + 2}</legend>
        <div className="form-grid">
          <label className="form-field" htmlFor={`${rowId}-kind`}><span>Кем приходится</span>
            <select id={`${rowId}-kind`} className="form-select" value={relationship.relationshipKind} disabled={disabled}
              ref={(element) => { if (element) selectRefs.current.set(rowId, element); else selectRefs.current.delete(rowId); }}
              onChange={(event) => update(index, { relationshipKind: event.target.value as PersonRelationshipInput["relationshipKind"] })}>
              <option value="child">Ребёнок</option><option value="parent">Родитель</option><option value="spouse">Супруг / супруга</option><option value="sibling">Брат / сестра</option>
            </select>
          </label>
          <label className="form-field" htmlFor={`${rowId}-relative`}><span>С кем связать</span>
            <select id={`${rowId}-relative`} className="form-select" required disabled={disabled} value={relativeValue}
              onChange={(event) => update(index, event.target.value.startsWith("draft:")
                ? { relativeClientId: event.target.value.slice(6), relativePersonId: "" }
                : { relativeClientId: undefined, relativePersonId: event.target.value.slice(9) })}>
              <option disabled value="">Выберите родственника</option>
              {candidates.length ? <optgroup label="В дереве">{candidates.map((relative) => <option key={relative.id} value={`existing:${relative.id}`}>{getPersonFullName(relative)}</option>)}</optgroup> : null}
              {earlierPeople.length ? <optgroup label="Из этого списка">{earlierPeople.map((relative, relativeIndex) => <option key={relative.clientId} value={`draft:${relative.clientId}`}>Человек {relativeIndex + 1} — {[relative.firstName, relative.lastName].filter(Boolean).join(" ") || "новая карточка"}</option>)}</optgroup> : null}
            </select>
          </label>
        </div>
        <button type="button" className="ghost-button additional-relationship__remove" disabled={disabled} aria-label={`Удалить связь ${index + 2}`} onClick={() => remove(index)}>Убрать связь</button>
      </fieldset>;
    })}
    <button ref={appendRef} type="button" className="secondary-button additional-relationship__append" disabled={disabled || relationships.length >= 9} onClick={append}>+ Ещё связь</button>
    <p className="batch-person-hint">Можно указать до 10 связей. Связи супругов и братьев или сестёр дополняют родителей автоматически. После сохранения их можно исправить или удалить в разделе «Связи человека».</p>
  </div>;
}

export function AutomaticParenthoodNotice({ relationshipKind }: { relationshipKind: ExistingRelationshipKind }) {
  if (relationshipKind === "spouse") return <p className="batch-person-hint">Для известных детей супругов родительские связи добавятся автоматически, если это не противоречит уже записанным родителям. Их можно исправить или удалить в разделе «Связи человека».</p>;
  if (relationshipKind === "sibling") return <p className="batch-person-hint">Известные родители станут общими для брата и сестры, если нет противоречий. Если родители не указаны, неизвестные родители не создаются. Связи можно исправить или удалить в разделе «Связи человека».</p>;
  return null;
}

export function ExistingRelationshipFields({
  subject, people, relativePersonId, relationshipKind, onRelativeChange, onKindChange, disabled = false,
}: {
  subject: FamilyPerson;
  people: FamilyPerson[];
  relativePersonId: string;
  relationshipKind: ExistingRelationshipKind;
  onRelativeChange: (id: string) => void;
  onKindChange: (kind: ExistingRelationshipKind) => void;
  disabled?: boolean;
}) {
  const candidates = people.filter((person) => person.id !== subject.id && !person.isArchived);
  const relative = candidates.find((person) => person.id === relativePersonId);
  const parentLabel = subject.gender === "female" ? "Мать" : "Отец";
  const childLabel = subject.gender === "female" ? "Дочь" : "Сын";
  const spouseLabel = subject.gender === "female" ? "Жена" : "Муж";
  const siblingLabel = subject.gender === "female" ? "Сестра" : "Брат";
  const parent = relationshipKind === "parent" ? subject : relative;
  const child = relationshipKind === "child" ? subject : relative;

  return (
    <>
      <p className="note-box">Выбранный человек: <strong>{getPersonFullName(subject)}</strong>. Новая карточка не создаётся.</p>
      <div className="form-grid">
        <label className="form-field">
          <span>Кем приходится выбранный человек</span>
          <select className="form-select" value={relationshipKind} disabled={disabled}
            onChange={(event) => onKindChange(event.target.value as ExistingRelationshipKind)}>
            <option value="parent">{parentLabel}</option>
            <option value="child">{childLabel}</option>
            <option value="spouse">{spouseLabel}</option>
            <option value="sibling">{siblingLabel}</option>
          </select>
        </label>
        <label className="form-field">
          <span>Связать с человеком</span>
          <select className="form-select" value={relativePersonId} required disabled={disabled || !candidates.length}
            onChange={(event) => onRelativeChange(event.target.value)}>
            <option value="" disabled>Выберите человека</option>
            {candidates.map((person) => <option key={person.id} value={person.id}>{getPersonFullName(person)}{person.birthDate ? ` · ${person.birthDate}` : ""}</option>)}
          </select>
        </label>
      </div>
      {!candidates.length ? <p className="note-box">Сначала добавьте в дерево ещё одного человека.</p> : null}
      {relative && parent && child ? <p className="note-box" role="status">
        {relationshipKind === "spouse"
          ? `Супруги: ${getPersonFullName(subject)} и ${getPersonFullName(relative)}.`
          : relationshipKind === "sibling"
            ? `${subject.gender === "female" && relative.gender === "female" ? "Сёстры" : subject.gender === "male" && relative.gender === "male" ? "Братья" : "Брат и сестра"}: ${getPersonFullName(subject)} и ${getPersonFullName(relative)}. Можно связать, даже если родители неизвестны.`
            : `${parent.gender === "female" ? "Мать" : "Отец"}: ${getPersonFullName(parent)}. Ребёнок: ${getPersonFullName(child)}.`}
      </p> : null}
      <AutomaticParenthoodNotice relationshipKind={relationshipKind} />
    </>
  );
}
