import type { Prisma } from "@prisma/client";
import { addRelationshipToFamily, type AddExistingRelationshipInput } from "@/lib/family-relationships";
import { applyAutomaticParenthood, formatParentInferenceWarnings } from "@/lib/family-parent-inference";
import { HttpError } from "@/lib/http-error";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import type { FamilyRelationship } from "@/lib/types";

const graphSelect = {
  id: true,
  people: { select: { id: true, isArchived: true, firstName: true, lastName: true } },
  // Archived relatives still count towards parent limits and ancestry constraints.
  relationships: { select: { id: true, fromPersonId: true, toPersonId: true, type: true, origin: true, sourcePersonId: true, version: true } },
  parentSuppressions: { select: { fromPersonId: true, toPersonId: true } },
} satisfies Prisma.FamilySelect;
type LoadedGraph = Prisma.FamilyGetPayload<{ select: typeof graphSelect }>;
type StoredRelationship = Omit<LoadedGraph["relationships"][number], "sourcePersonId"> & { sourcePersonId?: string };
type Graph = Omit<LoadedGraph, "relationships"> & { relationships: StoredRelationship[] };

function toDomainRelationship(relationship: LoadedGraph["relationships"][number]): StoredRelationship {
  return { ...relationship, sourcePersonId: relationship.sourcePersonId ?? undefined };
}

export type RelationshipVersionInput = { expectedVersion: number };
export type UpdateRelationshipInput = AddExistingRelationshipInput & RelationshipVersionInput;

export function parseRelationshipVersionInput(data: unknown): RelationshipVersionInput {
  const version = data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>).expectedVersion : undefined;
  if (!Number.isSafeInteger(version) || (version as number) < 0) {
    throw new HttpError(400, "Передайте текущую версию родственной связи.");
  }
  return { expectedVersion: version as number };
}

async function loadGraph(transaction: Prisma.TransactionClient, slug: string, actorUserId: string) {
  const family = await transaction.family.findUnique({ where: { slug }, select: graphSelect });
  if (!family) throw new HttpError(404, "Семья не найдена.");
  if (!actorUserId) throw new HttpError(403, "Недостаточно прав для этого действия.");
  const membership = await transaction.familyMembership.findFirst({
    where: { familyId: family.id, userId: actorUserId }, select: { role: true },
  });
  if (!membership || !["owner", "admin", "editor"].includes(membership.role)) {
    throw new HttpError(403, "Недостаточно прав для этого действия.");
  }
  return { ...family, relationships: family.relationships.map(toDomainRelationship) };
}

function relationshipKey(relationship: FamilyRelationship) {
  const pair = relationship.type === "parent"
    ? [relationship.fromPersonId, relationship.toPersonId]
    : [relationship.fromPersonId, relationship.toPersonId].sort();
  return JSON.stringify([relationship.type, ...pair]);
}

function name(family: Graph, personId: string) {
  const person = family.people.find((current) => current.id === personId)!;
  return `${person.firstName} ${person.lastName}`.trim();
}

function describe(family: Graph, relationship: FamilyRelationship) {
  const role = relationship.type === "parent" ? "родитель" : relationship.type === "spouse" ? "супруг(а)" : "брат/сестра";
  return `${name(family, relationship.fromPersonId)} — ${role} для ${name(family, relationship.toPersonId)}.`;
}

async function audit(
  transaction: Prisma.TransactionClient, family: Graph, personId: string, actorName: string, message: string,
) {
  await transaction.auditLog.create({ data: {
    familyId: family.id, action: "person_updated", actorName, personId,
    personName: name(family, personId), message,
  } });
}

async function clearSuppression(transaction: Prisma.TransactionClient, family: Graph, relationship: FamilyRelationship) {
  if (relationship.type !== "parent") return;
  await transaction.parentSuppression.deleteMany({ where: {
    familyId: family.id, fromPersonId: relationship.fromPersonId, toPersonId: relationship.toPersonId,
  } });
  family.parentSuppressions = family.parentSuppressions.filter((item) =>
    item.fromPersonId !== relationship.fromPersonId || item.toPersonId !== relationship.toPersonId);
}

async function saveSuppression(transaction: Prisma.TransactionClient, family: Graph, relationship: FamilyRelationship) {
  if (relationship.type !== "parent") return;
  const key = { familyId: family.id, fromPersonId: relationship.fromPersonId, toPersonId: relationship.toPersonId };
  await transaction.parentSuppression.upsert({
    where: { familyId_fromPersonId_toPersonId: key }, create: key, update: {},
  });
  if (!family.parentSuppressions.some((item) => item.fromPersonId === key.fromPersonId && item.toPersonId === key.toPersonId)) {
    family.parentSuppressions.push({ fromPersonId: key.fromPersonId, toPersonId: key.toPersonId });
  }
}

async function persistInferred(
  transaction: Prisma.TransactionClient, family: Graph, seed: FamilyRelationship, personId: string, actorName: string,
) {
  const inferred = applyAutomaticParenthood(family, [seed]);
  const recorded = new Set(family.relationships.map(relationshipKey));
  for (const relationship of inferred.family.relationships) {
    if (recorded.has(relationshipKey(relationship))) continue;
    await transaction.relationship.create({ data: {
      familyId: family.id, fromPersonId: relationship.fromPersonId, toPersonId: relationship.toPersonId,
      type: relationship.type, origin: relationship.origin ?? "manual", sourcePersonId: relationship.sourcePersonId ?? null,
    } });
    const reason = relationship.origin === "spouse" ? "супружества" : "связи братьев/сестёр";
    const source = relationship.sourcePersonId ? ` (${name(family, relationship.sourcePersonId)})` : "";
    await audit(transaction, family, personId, actorName,
      `Автоматически добавлена родительская связь на основании ${reason}${source}: ${describe(family, relationship)}`);
    recorded.add(relationshipKey(relationship));
  }
  return formatParentInferenceWarnings(inferred.warnings, family.people);
}

function findEditable(family: Graph, personId: string, relationshipId: string, expectedVersion: number) {
  const relationship = family.relationships.find((current) => current.id === relationshipId &&
    (current.fromPersonId === personId || current.toPersonId === personId));
  if (!relationship || !family.people.some((person) => person.id === personId && !person.isArchived)) {
    throw new HttpError(404, "Родственная связь не найдена.");
  }
  if (relationship.version !== expectedVersion) throw relationshipConflict();
  return relationship;
}

function relationshipConflict() {
  return new HttpError(409, "Родственная связь уже изменена. Черновик сохранён. Закройте форму и откройте связь заново, затем повторите нужные изменения.");
}

export async function createRelationshipInFamily(
  slug: string, personId: string, input: AddExistingRelationshipInput, actorName: string, actorUserId: string,
) {
  return withSerializableTransaction(async (transaction) => {
    const family = await loadGraph(transaction, slug, actorUserId);
    const result = addRelationshipToFamily(family, personId, input);
    let relationship: StoredRelationship;
    let changed = result.created;
    if (result.created) {
      relationship = toDomainRelationship(await transaction.relationship.create({ data: {
        familyId: family.id, fromPersonId: result.relationship.fromPersonId, toPersonId: result.relationship.toPersonId,
        type: result.relationship.type, origin: "manual", sourcePersonId: null,
      } }));
      family.relationships = [...family.relationships, relationship];
      await audit(transaction, family, personId, actorName, `Добавлена родственная связь: ${describe(family, relationship)}`);
    } else {
      relationship = family.relationships.find((current) => relationshipKey(current) === relationshipKey(result.relationship))!;
      if (relationship.origin !== "manual") {
        const updated = await transaction.relationship.updateMany({
          where: { id: relationship.id, familyId: family.id, version: relationship.version },
          data: { origin: "manual", sourcePersonId: null, version: { increment: 1 } },
        });
        if (updated.count !== 1) throw relationshipConflict();
        relationship = { ...relationship, origin: "manual", sourcePersonId: undefined, version: relationship.version + 1 };
        family.relationships = family.relationships.map((item) => item.id === relationship.id ? relationship : item);
        changed = true;
        await audit(transaction, family, personId, actorName, `Родственная связь подтверждена вручную: ${describe(family, relationship)}`);
      }
    }
    await clearSuppression(transaction, family, relationship);
    const warnings = await persistInferred(transaction, family, relationship, personId, actorName);
    return { personId, relationshipId: relationship.id, version: relationship.version, warnings,
      message: changed ? `Родственная связь сохранена. ${describe(family, relationship)}` : "Эта родственная связь уже указана." };
  }, { retryUnique: true });
}

export async function updateRelationshipInFamily(
  slug: string, personId: string, relationshipId: string, input: UpdateRelationshipInput, actorName: string, actorUserId: string,
) {
  const { expectedVersion } = parseRelationshipVersionInput(input);
  return withSerializableTransaction(async (transaction) => {
    const family = await loadGraph(transaction, slug, actorUserId);
    const old = findEditable(family, personId, relationshipId, expectedVersion);
    const withoutOld = { ...family, relationships: family.relationships.filter((item) => item.id !== old.id) };
    const result = addRelationshipToFamily(withoutOld, personId, input);
    if (!result.created) throw new HttpError(409, "Такая родственная связь уже существует.");
    const next: StoredRelationship = {
      ...old, fromPersonId: result.relationship.fromPersonId, toPersonId: result.relationship.toPersonId,
      type: result.relationship.type, origin: "manual", sourcePersonId: undefined, version: old.version + 1,
    };
    const update = await transaction.relationship.updateMany({
      where: { id: old.id, familyId: family.id, version: expectedVersion },
      data: { fromPersonId: next.fromPersonId, toPersonId: next.toPersonId, type: next.type, origin: "manual", sourcePersonId: null, version: { increment: 1 } },
    });
    if (update.count !== 1) throw relationshipConflict();
    if (relationshipKey(old) !== relationshipKey(next)) await saveSuppression(transaction, family, old);
    await clearSuppression(transaction, family, next);
    family.relationships = family.relationships.map((item) => item.id === old.id ? next : item);
    await audit(transaction, family, personId, actorName, `Изменена родственная связь: ${describe(family, old)} Теперь: ${describe(family, next)}`);
    const warnings = await persistInferred(transaction, family, next, personId, actorName);
    return { personId, relationshipId, version: next.version, message: "Родственная связь изменена.", warnings };
  }, { retryUnique: true });
}

export async function deleteRelationshipInFamily(
  slug: string, personId: string, relationshipId: string, input: RelationshipVersionInput, actorName: string, actorUserId: string,
) {
  const { expectedVersion } = parseRelationshipVersionInput(input);
  return withSerializableTransaction(async (transaction) => {
    const family = await loadGraph(transaction, slug, actorUserId);
    const relationship = findEditable(family, personId, relationshipId, expectedVersion);
    const removed = await transaction.relationship.deleteMany({ where: { id: relationshipId, familyId: family.id, version: expectedVersion } });
    if (removed.count !== 1) throw relationshipConflict();
    await saveSuppression(transaction, family, relationship);
    await audit(transaction, family, personId, actorName, `Удалена родственная связь: ${describe(family, relationship)}`);
    // Removing a source must neither infer new edges nor erase already recorded parents.
    return { personId, relationshipId, message: "Родственная связь удалена.", warnings: [] as string[] };
  });
}
