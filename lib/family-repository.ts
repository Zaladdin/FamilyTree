import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { addPeopleToFamily, type BatchPersonEntry } from "@/lib/family-batch";
import {
  addPersonToFamily,
  AddPersonInput,
  findDuplicatePersonForUpdate,
  normalizeText,
  PersonUpdateRequest,
  UpdatePersonInput,
} from "@/lib/family-logic";
import { HttpError } from "@/lib/http-error";
import { prisma } from "@/lib/prisma";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { formatParentInferenceWarnings } from "@/lib/family-parent-inference";
import { normalizeMultilineText } from "@/lib/content-text";
import { buildPersonTimeline, createPersonTimelineEvents } from "@/lib/person-timeline";
import { AuditAction, Family, FamilyPerson, FamilyRelationship } from "@/lib/types";

const familyOverviewInclude = {
  memberships: true,
  digitizationTasks: true,
  people: {
    orderBy: [{ birthDate: "asc" }, { firstName: "asc" }],
  },
  relationships: true,
  parentSuppressions: true,
  auditLogs: {
    take: 12,
    orderBy: {
      createdAt: "desc",
    },
  },
} satisfies Prisma.FamilyInclude;

const familyJournalInclude = {
  ...familyOverviewInclude,
  auditLogs: {
    take: 100,
    orderBy: {
      createdAt: "desc",
    },
  },
} satisfies Prisma.FamilyInclude;

const personDetailInclude = {
  family: {
    select: {
      slug: true,
    },
  },
  mediaAssets: {
    where: { state: "ready" },
    orderBy: {
      createdAt: "desc",
    },
  },
  stories: {
    orderBy: {
      createdAt: "desc",
    },
  },
  timelineEvents: {
    orderBy: {
      order: "asc",
    },
  },
} satisfies Prisma.PersonInclude;

type FamilyOverviewRecord = Prisma.FamilyGetPayload<{
  include: typeof familyOverviewInclude;
}>;

type PersonDetailRecord = Prisma.PersonGetPayload<{
  include: typeof personDetailInclude;
}>;

function mapPersonSummary(person: FamilyOverviewRecord["people"][number]): FamilyPerson {
  return {
    id: person.id,
    version: person.version,
    firstName: person.firstName,
    lastName: person.lastName,
    middleName: person.middleName || undefined,
    gender: person.gender,
    birthDate: person.birthDate,
    deathDate: person.deathDate ?? undefined,
    birthPlace: person.birthPlace,
    status: person.status,
    isArchived: person.isArchived,
    biography: person.biography,
    note: person.note ?? undefined,
    timeline: [],
    media: {
      photos: person.photosCount,
      audio: person.audioCount,
      documents: person.documentsCount,
    },
    mediaAssets: [],
    stories: [],
    memory: person.memoryTitle
      ? {
          title: person.memoryTitle,
          narrator: person.memoryNarrator ?? "",
          duration: person.memoryDuration ?? "",
          summary: person.memorySummary ?? "",
        }
      : undefined,
  };
}

function mapStory(story: PersonDetailRecord["stories"][number]) {
  return {
    id: story.id, title: story.title, body: story.body,
    narrator: story.narrator ?? undefined, createdAt: story.createdAt.toISOString(),
    version: story.version, deletedAt: story.deletedAt?.toISOString(),
  };
}

function mapPersonDetail(person: PersonDetailRecord, includeDeletedStories = false): FamilyPerson {
  return {
    id: person.id,
    version: person.version,
    firstName: person.firstName,
    lastName: person.lastName,
    middleName: person.middleName || undefined,
    gender: person.gender,
    birthDate: person.birthDate,
    deathDate: person.deathDate ?? undefined,
    birthPlace: person.birthPlace,
    status: person.status,
    isArchived: person.isArchived,
    biography: person.biography,
    note: person.note ?? undefined,
    timeline: buildPersonTimeline(person, person.timelineEvents),
    media: {
      photos: person.photosCount,
      audio: person.audioCount,
      documents: person.documentsCount,
    },
    mediaAssets: person.mediaAssets.filter((asset) => asset.state === "ready").map((asset) => ({
      id: asset.id,
      type: asset.type,
      title: asset.title,
      url: buildPrivateMediaUrl(person.family.slug, person.id, asset.id),
      mimeType: asset.mimeType,
      size: asset.size,
      createdAt: asset.createdAt.toISOString(),
    })),
    stories: person.stories.filter((story) => !story.deletedAt).map(mapStory),
    ...(includeDeletedStories ? { deletedStories: person.stories.filter((story) => story.deletedAt).map(mapStory) } : {}),
    memory: person.memoryTitle
      ? {
          title: person.memoryTitle,
          narrator: person.memoryNarrator ?? "",
          duration: person.memoryDuration ?? "",
          summary: person.memorySummary ?? "",
        }
      : undefined,
  };
}

function mapRelationship(relationship: FamilyOverviewRecord["relationships"][number]): FamilyRelationship {
  return {
    fromPersonId: relationship.fromPersonId,
    toPersonId: relationship.toPersonId,
    type: relationship.type,
    ...(relationship.id ? { id: relationship.id, version: relationship.version } : {}),
    ...(relationship.origin ? { origin: relationship.origin } : {}),
    ...(relationship.sourcePersonId ? { sourcePersonId: relationship.sourcePersonId } : {}),
  };
}

function mapFamily(record: FamilyOverviewRecord): Family {
  const activePeople = record.people.filter((person) => !person.isArchived);
  const archivedPeople = record.people.filter((person) => person.isArchived);
  const activePersonIds = new Set(activePeople.map((person) => person.id));

  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    surname: record.surname,
    description: record.description,
    region: record.region,
    coverQuote: record.coverQuote,
    stats: {
      people: record.peopleCount,
      photos: record.photosCount,
      audio: record.audioCount,
      stories: record.storiesCount,
      contributors: record.contributorsCount,
    },
    memberships: record.memberships.map((membership) => ({
      name: membership.name,
      role: membership.role,
    })),
    digitizationQueue: record.digitizationTasks.map((task) => ({
      title: task.title,
      owner: task.owner,
      status: task.status,
    })),
    people: activePeople.map(mapPersonSummary),
    archivedPeople: archivedPeople.map(mapPersonSummary),
    relationships: record.relationships
      .filter(
        (relationship) =>
          activePersonIds.has(relationship.fromPersonId) &&
          activePersonIds.has(relationship.toPersonId),
      )
      .map(mapRelationship),
    recordedRelationships: record.relationships.map(mapRelationship),
    parentSuppressions: (record.parentSuppressions ?? []).map(({ fromPersonId, toPersonId }) => ({ fromPersonId, toPersonId })),
    auditLog: record.auditLogs.map((entry) => ({
      id: entry.id,
      action: entry.action,
      actorName: entry.actorName,
      personId: entry.personId ?? undefined,
      personName: entry.personName ?? undefined,
      message: entry.message,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
}

function withFocusPersonDetail(family: Family, person: PersonDetailRecord, includeDeletedStories = false): Family {
  return {
    ...family,
    people: family.people.map((currentPerson) =>
      currentPerson.id === person.id ? mapPersonDetail(person, includeDeletedStories) : currentPerson,
    ),
  };
}

function formatPersonName(person: Pick<FamilyPerson, "firstName" | "middleName" | "lastName">) {
  return [person.firstName, person.middleName, person.lastName].filter(Boolean).join(" ");
}

function buildPrivateMediaUrl(familySlug: string, personId: string, assetId: string) {
  return `/api/family/${familySlug}/people/${personId}/media/${assetId}`;
}

async function createAuditLog(
  transaction: Prisma.TransactionClient,
  params: {
    familyId: string;
    action: AuditAction;
    message: string;
    personId?: string;
    personName?: string;
    actorName?: string;
  },
) {
  await transaction.auditLog.create({
    data: {
      familyId: params.familyId,
      action: params.action,
      actorName: params.actorName ?? "Система",
      personId: params.personId ?? null,
      personName: params.personName ?? null,
      message: params.message,
    },
  });
}

// Recomputes the denormalized Family counters from the underlying rows so they
// can never drift out of sync (e.g. after archiving, restoring, or cascade
// deletes). Stats reflect the active, non-archived tree.
async function recomputeFamilyStats(
  transaction: Prisma.TransactionClient,
  familyId: string,
) {
  const activePersonFilter = { familyId, isArchived: false } as const;

  const [peopleCount, photosCount, audioCount, storiesCount, contributorsCount] =
    await Promise.all([
      transaction.person.count({ where: activePersonFilter }),
      transaction.mediaAsset.count({
        where: { type: "photo", state: "ready", person: activePersonFilter },
      }),
      transaction.mediaAsset.count({
        where: { type: "audio", state: "ready", person: activePersonFilter },
      }),
      transaction.story.count({ where: { person: activePersonFilter, deletedAt: null } }),
      transaction.familyMembership.count({ where: { familyId } }),
    ]);

  await transaction.family.update({
    where: { id: familyId },
    data: {
      peopleCount,
      photosCount,
      audioCount,
      storiesCount,
      contributorsCount,
    },
  });
}

async function loadFamilyOverviewRecordBySlug(slug: string) {
  return prisma.family.findUnique({
    where: { slug },
    include: familyOverviewInclude,
  });
}

async function loadFamilyJournalRecordBySlug(slug: string) {
  return prisma.family.findUnique({
    where: { slug },
    include: familyJournalInclude,
  });
}

async function loadPersonDetailById(personId: string, includeDeletedStories = false) {
  return prisma.person.findUnique({
    where: { id: personId },
    include: { ...personDetailInclude, stories: { ...personDetailInclude.stories,
      ...(!includeDeletedStories ? { where: { deletedAt: null } } : {}),
    } },
  });
}

function getNewRelationships(
  currentRelationships: FamilyRelationship[],
  nextRelationships: FamilyRelationship[],
) {
  const currentKeys = new Set(
    currentRelationships.map(
      (relationship) =>
        `${relationship.type}:${relationship.fromPersonId}:${relationship.toPersonId}`,
    ),
  );

  return nextRelationships.filter(
    (relationship) =>
      !currentKeys.has(
        `${relationship.type}:${relationship.fromPersonId}:${relationship.toPersonId}`,
      ),
  );
}

export async function getFamilyBySlug(slug: string, focusPersonId?: string, options: { includeDeletedStories?: boolean } = {}) {
  const record = await loadFamilyOverviewRecordBySlug(slug);

  if (!record) {
    return null;
  }

  const family = mapFamily(record);
  const resolvedFocusPersonId =
    family.people.find((person) => person.id === focusPersonId)?.id ?? family.people[0]?.id;

  if (!resolvedFocusPersonId) {
    return family;
  }

  const focusPerson = await loadPersonDetailById(resolvedFocusPersonId, options.includeDeletedStories);

  if (!focusPerson) {
    return family;
  }

  return withFocusPersonDetail(family, focusPerson, options.includeDeletedStories);
}

export async function getFamilyJournalBySlug(slug: string) {
  const record = await loadFamilyJournalRecordBySlug(slug);

  if (!record) {
    return null;
  }

  return mapFamily(record);
}

async function persistCreatedPerson(transaction: Prisma.TransactionClient, familyId: string, person: FamilyPerson) {
  await transaction.person.create({
    data: {
      id: person.id,
      familyId,
      firstName: person.firstName,
      lastName: person.lastName,
      middleName: person.middleName ?? "",
      gender: person.gender,
      birthDate: person.birthDate,
      deathDate: person.deathDate ?? null,
      birthPlace: person.birthPlace,
      status: person.status,
      isArchived: false,
      biography: person.biography,
      note: person.note ?? null,
      photosCount: person.media.photos,
      audioCount: person.media.audio,
      documentsCount: person.media.documents,
      memoryTitle: person.memory?.title ?? null,
      memoryNarrator: person.memory?.narrator ?? null,
      memoryDuration: person.memory?.duration ?? null,
      memorySummary: person.memory?.summary ?? null,
      timelineEvents: {
        create: createPersonTimelineEvents(),
      },
    },
  });
}

function relationshipWriteData(familyId: string, relationship: FamilyRelationship): Prisma.RelationshipCreateManyInput {
  return {
    familyId,
    fromPersonId: relationship.fromPersonId,
    toPersonId: relationship.toPersonId,
    type: relationship.type,
    ...(relationship.origin && relationship.origin !== "manual"
      ? { origin: relationship.origin, sourcePersonId: relationship.sourcePersonId }
      : {}),
  };
}

async function auditAutomaticParents(
  transaction: Prisma.TransactionClient,
  familyId: string,
  actorName: string,
  relationships: FamilyRelationship[],
  people: FamilyPerson[],
) {
  const names = new Map(people.map((person) => [person.id, formatPersonName(person)]));
  for (const relationship of relationships) {
    if (relationship.origin !== "spouse" && relationship.origin !== "sibling") continue;
    const childName = names.get(relationship.toPersonId) ?? "Человек";
    const parentName = names.get(relationship.fromPersonId) ?? "Человек";
    const sourceName = relationship.sourcePersonId ? names.get(relationship.sourcePersonId) : undefined;
    await createAuditLog(transaction, {
      familyId, action: "person_updated", actorName,
      personId: relationship.toPersonId, personName: childName,
      message: `Добавлено автоматически: ${parentName} — родитель для ${childName}. Основание: ${relationship.origin === "spouse" ? "супружество" : "брат / сестра"}${sourceName ? `, ${sourceName}` : ""}.`,
    });
  }
}

export async function createPeopleInFamily(
  slug: string,
  entries: BatchPersonEntry[],
  actorName: string,
  actorUserId: string,
): Promise<{ people: FamilyPerson[]; warnings: string[] }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const familyRecord = await transaction.family.findUnique({ where: { slug }, include: familyOverviewInclude });
        if (!familyRecord) throw new HttpError(404, "Семья не найдена.");
        await requirePersonEditor(transaction, familyRecord.id, actorUserId);
        const currentFamily = mapFamily(familyRecord);
        // Preserve archived ancestry for parent-slot validation, like single creation.
        currentFamily.relationships = familyRecord.relationships.map(mapRelationship);
        const result = addPeopleToFamily(currentFamily, entries);
        // The pure planner uses family-local slugs. Persist globally unique IDs
        // because Person.id is a database-wide primary key, not family-scoped.
        const ids = new Map(result.people.map((person) => [person.id, randomUUID()]));
        const people = result.people.map((person) => ({ ...person, id: ids.get(person.id)! }));
        const newRelationships = getNewRelationships(currentFamily.relationships, result.family.relationships).map((relationship) => ({
          ...relationship,
          fromPersonId: ids.get(relationship.fromPersonId) ?? relationship.fromPersonId,
          toPersonId: ids.get(relationship.toPersonId) ?? relationship.toPersonId,
          ...(relationship.sourcePersonId ? { sourcePersonId: ids.get(relationship.sourcePersonId) ?? relationship.sourcePersonId } : {}),
        }));

        // Validate every row before writes; all referenced people exist before edges.
        for (const person of people) await persistCreatedPerson(transaction, familyRecord.id, person);
        if (newRelationships.length) {
          await transaction.relationship.createMany({ data: newRelationships.map((relationship) => relationshipWriteData(familyRecord.id, relationship)) });
        }
        await auditAutomaticParents(transaction, familyRecord.id, actorName, newRelationships, [...currentFamily.people, ...(currentFamily.archivedPeople ?? []), ...people]);
        for (const person of people) {
          await createAuditLog(transaction, {
            familyId: familyRecord.id, action: "person_created", actorName,
            personId: person.id, personName: formatPersonName(person),
            message: `${actorName} добавил(а) человека "${formatPersonName(person)}" в семейное дерево.`,
          });
        }
        await recomputeFamilyStats(transaction, familyRecord.id);
        return { people, warnings: formatParentInferenceWarnings(result.warnings, [...result.family.people, ...(result.family.archivedPeople ?? [])]) };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 20000 });
    } catch (error) {
      const conflict = error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code);
      if (!conflict) throw error;
      if (attempt === 2) throw new HttpError(409, "Дерево изменилось одновременно с вашим запросом. Попробуйте добавить людей ещё раз.");
    }
  }
  throw new HttpError(409, "Не удалось добавить людей. Попробуйте ещё раз.");
}

export async function createPersonInFamily(
  slug: string,
  input: AddPersonInput,
  actorName: string,
  actorUserId: string,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (transaction) => {
        // Read and validate the graph in the same transaction as the person and
        // edges, so concurrent additions cannot both claim a second-parent slot.
        const familyRecord = await transaction.family.findUnique({
          where: { slug },
          include: familyOverviewInclude,
        });
        if (!familyRecord) throw new HttpError(404, "Семья не найдена.");
        await requirePersonEditor(transaction, familyRecord.id, actorUserId);
        const currentFamily = mapFamily(familyRecord);
        // Archived relatives are hidden from the tree, not erased from ancestry.
        currentFamily.relationships = familyRecord.relationships.map(mapRelationship);
        const result = addPersonToFamily(currentFamily, input);
        // Planner IDs are family-local slugs; persisted IDs share a global keyspace.
        const person = { ...result.person, id: randomUUID() };
        const newRelationships = getNewRelationships(currentFamily.relationships, result.family.relationships).map((relationship) => ({
          ...relationship,
          fromPersonId: relationship.fromPersonId === result.person.id ? person.id : relationship.fromPersonId,
          toPersonId: relationship.toPersonId === result.person.id ? person.id : relationship.toPersonId,
          ...(relationship.sourcePersonId ? { sourcePersonId: relationship.sourcePersonId === result.person.id ? person.id : relationship.sourcePersonId } : {}),
        }));

        await persistCreatedPerson(transaction, familyRecord.id, person);

        if (newRelationships.length) {
          await transaction.relationship.createMany({
            data: newRelationships.map((relationship) => relationshipWriteData(familyRecord.id, relationship)),
          });
        }

        await auditAutomaticParents(transaction, familyRecord.id, actorName, newRelationships, [...currentFamily.people, ...(currentFamily.archivedPeople ?? []), person]);

        await recomputeFamilyStats(transaction, familyRecord.id);

        await createAuditLog(transaction, {
          familyId: familyRecord.id,
          action: "person_created",
          actorName,
          personId: person.id,
          personName: formatPersonName(person),
          message: `${actorName} добавил(а) человека "${formatPersonName(person)}" в семейное дерево.`,
        });
        return { ...person, warnings: formatParentInferenceWarnings(result.warnings, [...result.family.people, ...(result.family.archivedPeople ?? [])]) };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const conflict = error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code);
      if (!conflict) throw error;
      if (attempt === 2) {
        throw new HttpError(409, "Дерево изменилось одновременно с вашим запросом. Попробуйте добавить человека ещё раз.");
      }
    }
  }
  throw new HttpError(409, "Не удалось добавить человека. Попробуйте ещё раз.");
}

export async function updatePersonInFamily(
  slug: string,
  personId: string,
  input: PersonUpdateRequest,
  actorName: string,
  actorUserId: string,
) {
  try {
    return await withSerializableTransaction(async (transaction) => {
      const familyRecord = await transaction.family.findUnique({ where: { slug }, include: familyOverviewInclude });
      if (!familyRecord) throw new HttpError(404, "Семья не найдена.");
      await requirePersonEditor(transaction, familyRecord.id, actorUserId);
      const currentFamily = mapFamily(familyRecord);
      const currentPerson = currentFamily.people.find((person) => person.id === personId);
      if (!currentPerson) throw new HttpError(404, "Человек не найден.");
      if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
        throw new HttpError(400, "Нужна версия редактируемой карточки. Откройте её заново.");
      }
      if (currentPerson.version !== input.expectedVersion) {
        throw new HttpError(409, "Карточка уже изменена другим пользователем. Ваши данные остались в форме. Откройте актуальную карточку перед повторным сохранением.");
      }
      const normalizedInput: UpdatePersonInput = {
        firstName: normalizeText(input.firstName), lastName: normalizeText(input.lastName),
        middleName: normalizeText(input.middleName ?? ""), gender: input.gender,
        birthDate: normalizeText(input.birthDate), birthPlace: normalizeText(input.birthPlace),
        biography: normalizeMultilineText(input.biography), note: normalizeMultilineText(input.note ?? ""),
        status: input.status, deathDate: normalizeText(input.deathDate ?? ""),
      };
      const duplicate = findDuplicatePersonForUpdate(currentFamily, personId, normalizedInput);
      if (duplicate) {
        throw new HttpError(409, `Человек "${formatPersonName(duplicate)}" с датой рождения ${duplicate.birthDate} уже есть в этой семье.`);
      }
      const updated = await transaction.person.update({
        where: { id: personId, familyId: familyRecord.id, isArchived: false, version: input.expectedVersion },
        data: {
          ...normalizedInput,
          middleName: normalizedInput.middleName || "",
          note: normalizedInput.note || null,
          deathDate: normalizedInput.status === "deceased" && normalizedInput.deathDate ? normalizedInput.deathDate : null,
          version: { increment: 1 },
        },
      });
      await createAuditLog(transaction, {
        familyId: familyRecord.id, action: "person_updated", actorName, personId,
        personName: formatPersonName(currentPerson),
        message: `${actorName} обновил(а) карточку человека "${formatPersonName(currentPerson)}".`,
      });
      return mapPersonSummary(updated);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") throw new HttpError(409, "Карточка изменилась во время сохранения. Ваши данные остались в форме.");
      if (error.code === "P2002") throw new HttpError(409, "Человек с таким именем и датой рождения уже есть в этой семье.");
    }
    throw error;
  }
}

export { createStoryForPerson } from "@/lib/family-story-repository";

export { deleteMediaAssetFromPerson, getMediaAssetForFamily } from "@/lib/family-media-repository";

export async function archivePersonInFamily(params: {
  slug: string;
  personId: string;
  actorUserId: string;
  actorName?: string;
}) {
  return setPersonArchiveState(params, true);
}

export async function restorePersonInFamily(params: {
  slug: string;
  personId: string;
  actorUserId: string;
  actorName?: string;
}) {
  return setPersonArchiveState(params, false);
}

async function requirePersonEditor(transaction: Prisma.TransactionClient, familyId: string, actorUserId: string) {
  // The route's role check is only an early rejection; permissions can change
  // before this transaction starts or while a failed attempt is being retried.
  if (!actorUserId) throw new HttpError(403, "Недостаточно прав для этого действия.");
  const membership = await transaction.familyMembership.findFirst({
    where: { familyId, userId: actorUserId },
    select: { role: true },
  });
  if (!membership || !["owner", "admin", "editor"].includes(membership.role)) {
    throw new HttpError(403, "Недостаточно прав для этого действия.");
  }
}

async function setPersonArchiveState(
  { slug, personId, actorUserId, actorName = "Система" }: {
    slug: string; personId: string; actorUserId: string; actorName?: string;
  },
  isArchived: boolean,
) {
  return withSerializableTransaction(async (transaction) => {
    const family = await transaction.family.findUnique({ where: { slug }, select: { id: true } });
    if (!family) throw new HttpError(404, "Семья не найдена.");
    const familyId = family.id;
    await requirePersonEditor(transaction, familyId, actorUserId);
    const person = await transaction.person.findFirst({
      where: { id: personId, familyId },
      select: { id: true, firstName: true, middleName: true, lastName: true, isArchived: true },
    });
    if (!person) throw new HttpError(404, "Человек не найден.");
    if (person.isArchived === isArchived) {
      throw new HttpError(409, isArchived
        ? "Этот человек уже находится в архиве."
        : "Этот человек уже находится в активном дереве.");
    }

    if (isArchived && await transaction.person.count({ where: { familyId, isArchived: false } }) <= 1) {
      throw new HttpError(409, "Нельзя архивировать последнего активного человека в семье.");
    }

    await transaction.person.update({
      where: { id: personId },
      data: { isArchived, version: { increment: 1 } },
    });
    await recomputeFamilyStats(transaction, familyId);
    await createAuditLog(transaction, {
      familyId,
      action: isArchived ? "person_archived" : "person_restored",
      actorName,
      personId,
      personName: formatPersonName(person),
      message: isArchived
        ? `${actorName} перенес(ла) "${formatPersonName(person)}" в архив семьи.`
        : `${actorName} восстановил(а) "${formatPersonName(person)}" из архива.`,
    });
    return person.id;
  });
}
