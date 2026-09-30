import { addPersonToFamily, type AddPersonInput } from "@/lib/family-logic";
import { HttpError } from "@/lib/http-error";
import { parseAddPersonInput } from "@/lib/request-validation";
import type { Family, FamilyPerson } from "@/lib/types";
import { applyAutomaticParenthood, type ParentInferenceWarning } from "@/lib/family-parent-inference";

export const MAX_BATCH_PEOPLE = 10;

export type BatchPersonEntry = AddPersonInput & {
  clientId: string;
  relativeClientId?: string;
};

function draftId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) {
    throw new HttpError(400, "Некорректный идентификатор карточки в списке.");
  }
  return value.trim();
}

function rowError(index: number, error: unknown): HttpError {
  return new HttpError(400, `Человек ${index + 1}: ${error instanceof Error ? error.message : "Проверьте данные карточки."}`);
}

/** Draft references can only point backwards, so order is explicit and cycles are impossible. */
export function parseBatchPersonInput(data: unknown): BatchPersonEntry[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError(400, "Некорректный список людей.");
  }
  const rows = (data as Record<string, unknown>).people;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_BATCH_PEOPLE) {
    throw new HttpError(400, `Добавьте от 1 до ${MAX_BATCH_PEOPLE} человек за один раз.`);
  }

  const seen = new Set<string>();
  return rows.map((row, index) => {
    try {
      const input = parseAddPersonInput(row, { allowDraftReferences: true });
      const source = row as Record<string, unknown>;
      const clientId = draftId(source.clientId);
      if (seen.has(clientId)) throw new HttpError(400, "Идентификаторы карточек должны быть уникальными.");
      const relativeClientId = source.relativeClientId === undefined || source.relativeClientId === ""
        ? undefined : draftId(source.relativeClientId);
      if (relativeClientId) {
        if (input.relativePersonId) throw new HttpError(400, "Выберите только одного родственника для связи.");
        if (!seen.has(relativeClientId)) throw new HttpError(400, "Выберите родственника из предыдущих карточек списка.");
      }
      for (const link of input.additionalRelationships ?? []) {
        if (link.relativeClientId && !seen.has(link.relativeClientId)) {
          throw new HttpError(400, "Выберите родственника из предыдущих карточек списка.");
        }
      }
      seen.add(clientId);
      return { ...input, clientId, ...(relativeClientId ? { relativeClientId } : {}) };
    } catch (error) {
      throw rowError(index, error);
    }
  });
}

/** Validate the complete batch in memory before any database writes. The input graph is never mutated. */
export function addPeopleToFamily(family: Family, entries: BatchPersonEntry[]): { family: Family; people: FamilyPerson[]; warnings: ParentInferenceWarning[] } {
  const rows = parseBatchPersonInput({ people: entries });
  const createdByDraftId = new Map<string, string>();
  const people: FamilyPerson[] = [];
  let nextFamily = family;
  for (const [index, row] of rows.entries()) {
    try {
      const relativePersonId = row.relativeClientId ? createdByDraftId.get(row.relativeClientId)! : row.relativePersonId;
      if (nextFamily.people.length === 0 && relativePersonId) {
        throw new Error("Первый человек в пустом дереве добавляется без родственника.");
      }
      const additionalRelationships = (row.additionalRelationships ?? []).map((link) => ({
        relationshipKind: link.relationshipKind,
        relativePersonId: link.relativeClientId ? createdByDraftId.get(link.relativeClientId)! : link.relativePersonId,
      }));
      const result = addPersonToFamily(nextFamily, { ...row, relativePersonId, additionalRelationships }, { deferInference: true });
      people.push(result.person);
      createdByDraftId.set(row.clientId, result.person.id);
      nextFamily = result.family;
    } catch (error) {
      throw rowError(index, error);
    }
  }
  const inferred = applyAutomaticParenthood(nextFamily, nextFamily.relationships.slice(family.relationships.length));
  return { family: inferred.family, people, warnings: inferred.warnings };
}
