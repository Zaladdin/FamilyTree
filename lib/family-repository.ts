import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  addPersonToFamily,
  AddPersonInput,
  findDuplicatePersonForUpdate,
  normalizeText,
  UpdatePersonInput,
} from "@/lib/family-logic";
import { deleteUploadByStoragePath } from "@/lib/media-storage";
import { prisma } from "@/lib/prisma";
import { AuditAction, Family, FamilyPerson, FamilyRelationship, MediaAssetType } from "@/lib/types";

const familyOverviewInclude = {
  memberships: true,
  digitizationTasks: true,
  people: {
    orderBy: [{ birthDate: "asc" }, { firstName: "asc" }],
  },
  relationships: true,
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

function mapPersonDetail(person: PersonDetailRecord): FamilyPerson {
  return {
    id: person.id,
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
    timeline: person.timelineEvents.map((event) => event.label),
    media: {
      photos: person.photosCount,
      audio: person.audioCount,
      documents: person.documentsCount,
    },
    mediaAssets: person.mediaAssets.map((asset) => ({
      id: asset.id,
      type: asset.type,
      title: asset.title,
      url: buildPrivateMediaUrl(person.family.slug, person.id, asset.id),
      mimeType: asset.mimeType,
      size: asset.size,
      createdAt: asset.createdAt.toISOString(),
    })),
    stories: person.stories.map((story) => ({
      id: story.id,
      title: story.title,
      body: story.body,
      narrator: story.narrator ?? undefined,
      createdAt: story.createdAt.toISOString(),
    })),
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
      .map((relationship) => ({
        fromPersonId: relationship.fromPersonId,
        toPersonId: relationship.toPersonId,
        type: relationship.type,
      })),
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

function withFocusPersonDetail(family: Family, person: PersonDetailRecord): Family {
  return {
    ...family,
    people: family.people.map((currentPerson) =>
      currentPerson.id === person.id ? mapPersonDetail(person) : currentPerson,
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
        where: { type: "photo", person: activePersonFilter },
      }),
      transaction.mediaAsset.count({
        where: { type: "audio", person: activePersonFilter },
      }),
      transaction.story.count({ where: { person: activePersonFilter } }),
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

async function loadPersonDetailById(personId: string) {
  return prisma.person.findUnique({
    where: { id: personId },
    include: personDetailInclude,
  });
}

// Mutations that touch a single person only need the family id and that
// person's name/flags, so they use these narrow lookups instead of loading the
// whole family with every media asset, story and timeline event.
async function loadFamilyIdBySlug(slug: string) {
  const family = await prisma.family.findUnique({
    where: { slug },
    select: { id: true },
  });

  return family?.id ?? null;
}

async function loadPersonInFamily(familyId: string, personId: string) {
  return prisma.person.findFirst({
    where: { id: personId, familyId },
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      isArchived: true,
    },
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

export async function getFamilyBySlug(slug: string, focusPersonId?: string) {
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

  const focusPerson = await loadPersonDetailById(resolvedFocusPersonId);

  if (!focusPerson) {
    return family;
  }

  return withFocusPersonDetail(family, focusPerson);
}

export async function getFamilyJournalBySlug(slug: string) {
  const record = await loadFamilyJournalRecordBySlug(slug);

  if (!record) {
    return null;
  }

  return mapFamily(record);
}

export async function createPersonInFamily(
  slug: string,
  input: AddPersonInput,
  actorName = "Система",
) {
  const familyRecord = await loadFamilyOverviewRecordBySlug(slug);

  if (!familyRecord) {
    throw new Error("Семья не найдена.");
  }

  const currentFamily = mapFamily(familyRecord);
  const result = addPersonToFamily(currentFamily, input);
  const newRelationships = getNewRelationships(
    currentFamily.relationships,
    result.family.relationships,
  );

  await prisma.$transaction(async (transaction) => {
    await transaction.person.create({
      data: {
        id: result.person.id,
        familyId: familyRecord.id,
        firstName: result.person.firstName,
        lastName: result.person.lastName,
        middleName: result.person.middleName ?? "",
        gender: result.person.gender,
        birthDate: result.person.birthDate,
        deathDate: result.person.deathDate ?? null,
        birthPlace: result.person.birthPlace,
        status: result.person.status,
        isArchived: false,
        biography: result.person.biography,
        note: result.person.note ?? null,
        photosCount: result.person.media.photos,
        audioCount: result.person.media.audio,
        documentsCount: result.person.media.documents,
        memoryTitle: result.person.memory?.title ?? null,
        memoryNarrator: result.person.memory?.narrator ?? null,
        memoryDuration: result.person.memory?.duration ?? null,
        memorySummary: result.person.memory?.summary ?? null,
        timelineEvents: {
          create: result.person.timeline.map((label, index) => ({
            label,
            order: index,
          })),
        },
      },
    });

    if (newRelationships.length) {
      await transaction.relationship.createMany({
        data: newRelationships.map((relationship) => ({
          familyId: familyRecord.id,
          fromPersonId: relationship.fromPersonId,
          toPersonId: relationship.toPersonId,
          type: relationship.type,
        })),
      });
    }

    await recomputeFamilyStats(transaction, familyRecord.id);

    await createAuditLog(transaction, {
      familyId: familyRecord.id,
      action: "person_created",
      actorName,
      personId: result.person.id,
      personName: formatPersonName(result.person),
      message: `${actorName} добавил(а) человека "${formatPersonName(result.person)}" в семейное дерево.`,
    });
  });

  return result.person;
}

export async function updatePersonInFamily(
  slug: string,
  personId: string,
  input: UpdatePersonInput,
  actorName = "Система",
) {
  const familyRecord = await loadFamilyOverviewRecordBySlug(slug);

  if (!familyRecord) {
    throw new Error("Семья не найдена.");
  }

  const currentFamily = mapFamily(familyRecord);
  const currentPerson = currentFamily.people.find((person) => person.id === personId);

  if (!currentPerson) {
    throw new Error("Человек не найден.");
  }

  const normalizedInput: UpdatePersonInput = {
    firstName: normalizeText(input.firstName),
    lastName: normalizeText(input.lastName),
    middleName: normalizeText(input.middleName ?? ""),
    gender: input.gender,
    birthDate: normalizeText(input.birthDate),
    birthPlace: normalizeText(input.birthPlace),
    biography: normalizeText(input.biography),
    note: normalizeText(input.note ?? ""),
    status: input.status,
    deathDate: normalizeText(input.deathDate ?? ""),
  };

  const duplicate = findDuplicatePersonForUpdate(
    currentFamily,
    personId,
    normalizedInput,
  );

  if (duplicate) {
    throw new Error(
      `Человек "${[
        duplicate.firstName,
        duplicate.middleName,
        duplicate.lastName,
      ]
        .filter(Boolean)
        .join(" ")}" с датой рождения ${duplicate.birthDate} уже есть в этой семье.`,
    );
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.person.update({
      where: {
        id: currentPerson.id,
      },
      data: {
        firstName: normalizedInput.firstName,
        lastName: normalizedInput.lastName,
        middleName: normalizedInput.middleName || "",
        gender: normalizedInput.gender,
        birthDate: normalizedInput.birthDate,
        birthPlace: normalizedInput.birthPlace,
        biography: normalizedInput.biography,
        note: normalizedInput.note || null,
        status: normalizedInput.status,
        deathDate:
          normalizedInput.status === "deceased" && normalizedInput.deathDate
            ? normalizedInput.deathDate
            : null,
      },
    });

    await createAuditLog(transaction, {
      familyId: familyRecord.id,
      action: "person_updated",
      actorName,
      personId: currentPerson.id,
      personName: formatPersonName(currentPerson),
      message: `${actorName} обновил(а) карточку человека "${formatPersonName(currentPerson)}".`,
    });
  });

  return {
    ...currentPerson,
    firstName: normalizedInput.firstName,
    lastName: normalizedInput.lastName,
    middleName: normalizedInput.middleName || undefined,
    gender: normalizedInput.gender,
    birthDate: normalizedInput.birthDate,
    birthPlace: normalizedInput.birthPlace,
    biography: normalizedInput.biography,
    note: normalizedInput.note || undefined,
    status: normalizedInput.status,
    isArchived: currentPerson.isArchived,
    deathDate:
      normalizedInput.status === "deceased" && normalizedInput.deathDate
        ? normalizedInput.deathDate
        : undefined,
    mediaAssets: currentPerson.mediaAssets,
    stories: currentPerson.stories,
  };
}

export async function createStoryForPerson(params: {
  slug: string;
  personId: string;
  title: string;
  body: string;
  narrator?: string;
  actorName?: string;
}) {
  const {
    slug,
    personId,
    title,
    body,
    narrator,
    actorName = "Система",
  } = params;
  const familyId = await loadFamilyIdBySlug(slug);

  if (!familyId) {
    throw new Error("Семья не найдена.");
  }

  const person = await loadPersonInFamily(familyId, personId);

  if (!person) {
    throw new Error("Человек не найден.");
  }

  const story = await prisma.$transaction(async (transaction) => {
    const createdStory = await transaction.story.create({
      data: {
        personId,
        title: normalizeText(title),
        body: normalizeText(body),
        narrator: normalizeText(narrator ?? "") || null,
      },
    });

    await recomputeFamilyStats(transaction, familyId);

    await createAuditLog(transaction, {
      familyId,
      action: "story_added",
      actorName,
      personId,
      personName: formatPersonName(person),
      message: `${actorName} добавил(а) историю "${normalizeText(title)}" в карточку "${formatPersonName(person)}".`,
    });

    return createdStory;
  });

  return {
    id: story.id,
    title: story.title,
    body: story.body,
    narrator: story.narrator ?? undefined,
    createdAt: story.createdAt.toISOString(),
  };
}

export async function createMediaAssetForPerson(params: {
  slug: string;
  personId: string;
  type: MediaAssetType;
  title: string;
  storagePath: string;
  mimeType: string;
  size: number;
  actorName?: string;
}) {
  const { slug, personId, type, title, storagePath, mimeType, size, actorName = "Система" } =
    params;
  const familyId = await loadFamilyIdBySlug(slug);

  if (!familyId) {
    throw new Error("Семья не найдена.");
  }

  const person = await loadPersonInFamily(familyId, personId);

  if (!person) {
    throw new Error("Человек не найден.");
  }

  const asset = await prisma.$transaction(async (transaction) => {
    const createdAssetId = randomUUID();
    const createdAsset = await transaction.mediaAsset.create({
      data: {
        id: createdAssetId,
        personId,
        type,
        title: normalizeText(title) || `${type}-${Date.now()}`,
        storagePath,
        mimeType,
        size,
      },
    });

    await transaction.person.update({
      where: { id: personId },
      data:
        type === "photo"
          ? {
              photosCount: {
                increment: 1,
              },
            }
          : {
              audioCount: {
                increment: 1,
              },
            },
    });

    await recomputeFamilyStats(transaction, familyId);

    await createAuditLog(transaction, {
      familyId,
      action: "media_added",
      actorName,
      personId,
      personName: formatPersonName(person),
      message: `${actorName} добавил(а) ${type === "photo" ? "фото" : "аудио"} в карточку "${formatPersonName(person)}".`,
    });

    return createdAsset;
  });

  return {
    id: asset.id,
    type: asset.type,
    title: asset.title,
    url: buildPrivateMediaUrl(slug, personId, asset.id),
    mimeType: asset.mimeType,
    size: asset.size,
    createdAt: asset.createdAt.toISOString(),
  };
}

export async function deleteMediaAssetFromPerson(params: {
  slug: string;
  personId: string;
  assetId: string;
  actorName?: string;
}) {
  const { slug, personId, assetId, actorName = "Система" } = params;
  const familyId = await loadFamilyIdBySlug(slug);

  if (!familyId) {
    throw new Error("Семья не найдена.");
  }

  const person = await loadPersonInFamily(familyId, personId);

  if (!person) {
    throw new Error("Человек не найден.");
  }

  const asset = await prisma.mediaAsset.findFirst({
    where: { id: assetId, personId },
  });

  if (!asset) {
    throw new Error("Медиафайл не найден.");
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.mediaAsset.delete({
      where: {
        id: asset.id,
      },
    });

    await transaction.person.update({
      where: { id: personId },
      data:
        asset.type === "photo"
          ? {
              photosCount: {
                decrement: 1,
              },
            }
          : {
              audioCount: {
                decrement: 1,
              },
            },
    });

    await recomputeFamilyStats(transaction, familyId);

    await createAuditLog(transaction, {
      familyId,
      action: "media_deleted",
      actorName,
      personId,
      personName: formatPersonName(person),
      message: `${actorName} удалил(а) ${asset.type === "photo" ? "фото" : "аудио"} из карточки "${formatPersonName(person)}".`,
    });
  });

  await deleteUploadByStoragePath(asset.storagePath);

  return asset;
}

export async function getMediaAssetForFamily(params: {
  slug: string;
  personId: string;
  assetId: string;
}) {
  const asset = await prisma.mediaAsset.findFirst({
    where: {
      id: params.assetId,
      personId: params.personId,
      person: {
        family: {
          slug: params.slug,
        },
      },
    },
    select: {
      id: true,
      title: true,
      mimeType: true,
      size: true,
      storagePath: true,
      type: true,
    },
  });

  if (!asset) {
    throw new Error("Медиафайл не найден.");
  }

  return asset;
}

export async function archivePersonInFamily(params: {
  slug: string;
  personId: string;
  actorName?: string;
}) {
  const { slug, personId, actorName = "Система" } = params;
  const familyId = await loadFamilyIdBySlug(slug);

  if (!familyId) {
    throw new Error("Семья не найдена.");
  }

  const person = await loadPersonInFamily(familyId, personId);

  if (!person) {
    throw new Error("Человек не найден.");
  }

  if (person.isArchived) {
    throw new Error("Этот человек уже находится в архиве.");
  }

  const activePeopleCount = await prisma.person.count({
    where: { familyId, isArchived: false },
  });

  if (activePeopleCount <= 1) {
    throw new Error("Нельзя архивировать последнего активного человека в семье.");
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.person.update({
      where: { id: personId },
      data: {
        isArchived: true,
      },
    });

    await recomputeFamilyStats(transaction, familyId);

    await createAuditLog(transaction, {
      familyId,
      action: "person_archived",
      actorName,
      personId,
      personName: formatPersonName(person),
      message: `${actorName} перенес(ла) "${formatPersonName(person)}" в архив семьи.`,
    });
  });

  return person.id;
}

export async function restorePersonInFamily(params: {
  slug: string;
  personId: string;
  actorName?: string;
}) {
  const { slug, personId, actorName = "Система" } = params;
  const familyId = await loadFamilyIdBySlug(slug);

  if (!familyId) {
    throw new Error("Семья не найдена.");
  }

  const person = await loadPersonInFamily(familyId, personId);

  if (!person) {
    throw new Error("Человек не найден.");
  }

  if (!person.isArchived) {
    throw new Error("Этот человек уже находится в активном дереве.");
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.person.update({
      where: { id: personId },
      data: {
        isArchived: false,
      },
    });

    await recomputeFamilyStats(transaction, familyId);

    await createAuditLog(transaction, {
      familyId,
      action: "person_restored",
      actorName,
      personId,
      personName: formatPersonName(person),
      message: `${actorName} восстановил(а) "${formatPersonName(person)}" из архива.`,
    });
  });

  return person.id;
}
