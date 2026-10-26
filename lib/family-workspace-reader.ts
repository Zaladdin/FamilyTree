import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getFamilyPersonDetail } from "@/lib/family-repository";
import type { Family, FamilyPerson, FamilyRelationship } from "@/lib/types";

// Page reads are deliberately separate from the complete graph used by writes.
const personSummarySelect = {
  id: true, version: true, firstName: true, lastName: true, middleName: true,
  gender: true, birthDate: true, deathDate: true, birthPlace: true, status: true,
  isArchived: true, photosCount: true, audioCount: true, documentsCount: true,
  mediaAssets: {
    where: { state: "ready", type: "photo" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { id: true },
  },
} satisfies Prisma.PersonSelect;

const relationshipSelect = {
  id: true, fromPersonId: true, toPersonId: true, type: true,
  version: true, origin: true, sourcePersonId: true,
} satisfies Prisma.RelationshipSelect;

type SummaryRecord = Prisma.PersonGetPayload<{ select: typeof personSummarySelect }>;

function mapSummary(person: SummaryRecord, slug: string): FamilyPerson {
  const avatar = person.mediaAssets[0];
  return {
    id: person.id, version: person.version, detailsLoaded: false,
    firstName: person.firstName, lastName: person.lastName, middleName: person.middleName || undefined,
    gender: person.gender, birthDate: person.birthDate, deathDate: person.deathDate ?? undefined,
    birthPlace: person.birthPlace, status: person.status, isArchived: person.isArchived,
    biography: "", timeline: [], stories: [], mediaAssets: [],
    media: { photos: person.photosCount, audio: person.audioCount, documents: person.documentsCount },
    ...(avatar ? { avatarUrl: `/api/family/${slug}/people/${person.id}/media/${avatar.id}` } : {}),
  };
}

export async function getFamilyWorkspaceBySlug(slug: string, focusPersonId?: string, { canEdit = false }: { canEdit?: boolean } = {}): Promise<Family | null> {
  const record = await prisma.family.findUnique({
    where: { slug },
    select: {
      id: true, slug: true, title: true, surname: true, description: true, region: true, coverQuote: true,
      peopleCount: true, photosCount: true, audioCount: true, storiesCount: true, contributorsCount: true,
      people: { where: { isArchived: false }, orderBy: [{ birthDate: "asc" }, { firstName: "asc" }, { id: "asc" }], select: personSummarySelect },
      relationships: {
        where: { OR: [
          { fromPerson: { isArchived: false }, toPerson: { isArchived: false } },
          ...(canEdit && focusPersonId ? [{ fromPersonId: focusPersonId }, { toPersonId: focusPersonId }] : []),
        ] },
        select: relationshipSelect,
      },
      auditLogs: {
        take: 4, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, action: true, actorName: true, personId: true, personName: true, message: true, createdAt: true },
      },
    },
  });
  if (!record) return null;

  const people = record.people.map((person) => mapSummary(person, record.slug));
  const activeIds = new Set(people.map((person) => person.id));
  const selectedId = focusPersonId && activeIds.has(focusPersonId) ? focusPersonId : undefined;
  const edges: FamilyRelationship[] = record.relationships.map(({ sourcePersonId, ...edge }) => ({
    ...edge, ...(sourcePersonId ? { sourcePersonId } : {}),
  }));
  const recorded = canEdit && selectedId ? edges.filter((edge) => edge.fromPersonId === selectedId || edge.toPersonId === selectedId) : [];
  const archivedIds = [...new Set(recorded.flatMap((edge) => [edge.fromPersonId, edge.toPersonId, ...(edge.sourcePersonId ? [edge.sourcePersonId] : [])]))]
    .filter((id) => !activeIds.has(id));

  const [detail, archived] = await Promise.all([
    selectedId ? getFamilyPersonDetail(record.id, selectedId, canEdit) : null,
    archivedIds.length ? prisma.person.findMany({
      where: { familyId: record.id, isArchived: true, id: { in: archivedIds } }, select: personSummarySelect,
    }) : [],
  ]);
  if (selectedId && !detail) {
    throw new Error("Карточка изменилась во время загрузки. Попробуйте открыть её снова.");
  }

  return {
    id: record.id, slug: record.slug, title: record.title, surname: record.surname,
    description: record.description, region: record.region, coverQuote: record.coverQuote,
    stats: { people: record.peopleCount, photos: record.photosCount, audio: record.audioCount, stories: record.storiesCount, contributors: record.contributorsCount },
    memberships: [], digitizationQueue: [],
    people: people.map((person) => person.id === detail?.id ? detail : person),
    archivedPeople: archived.map((person) => mapSummary(person, record.slug)),
    relationships: edges.filter((edge) => activeIds.has(edge.fromPersonId) && activeIds.has(edge.toPersonId)),
    ...(canEdit ? { recordedRelationships: recorded } : {}),
    auditLog: record.auditLogs.map((entry) => ({
      ...entry, personId: entry.personId ?? undefined, personName: entry.personName ?? undefined,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
}
