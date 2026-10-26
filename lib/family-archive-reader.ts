import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { FamilyPerson } from "@/lib/types";

const ARCHIVE_PAGE_SIZE = 24;

export type ArchiveCursorQuery = { after?: string | string[]; before?: string | string[] };
export type ArchivePagination = {
  previousCursor: string | null;
  nextCursor: string | null;
  isFiltered: boolean;
};
export type ArchivePerson = Pick<FamilyPerson,
  "id" | "firstName" | "lastName" | "middleName" | "birthDate" | "birthPlace" | "status" | "biography" | "media">;
export type FamilyArchivePageData = {
  slug: string;
  title: string;
  people: { id: string }[];
  archivedPeople: ArchivePerson[];
  pagination: ArchivePagination;
};
export type FamilyJournalPageData = {
  slug: string;
  title: string;
  people: { id: string }[];
  auditLog: { id: string; actorName: string; message: string; personName?: string; createdAt: string }[];
};

const fallbackPerson = {
  where: { isArchived: false }, orderBy: { id: "asc" }, take: 1, select: { id: true },
} satisfies Prisma.PersonFindManyArgs;

const archivePersonSelect = {
  id: true, firstName: true, lastName: true, middleName: true,
  birthDate: true, birthPlace: true, status: true, biography: true,
  photosCount: true, audioCount: true, documentsCount: true,
} satisfies Prisma.PersonSelect;

/** Invalid, repeated or conflicting query values never become an unbounded query. */
export function normalizeArchiveCursor(query: ArchiveCursorQuery = {}): { after?: string; before?: string } {
  const valid = (value: unknown): value is string => typeof value === "string"
    && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
  if (query.after !== undefined && query.before !== undefined) return {};
  if (query.after !== undefined) return valid(query.after) ? { after: query.after } : {};
  if (query.before !== undefined) return valid(query.before) ? { before: query.before } : {};
  return {};
}

/** A separate read projection: write-side graph/duplicate checks remain complete. */
export async function getFamilyArchivePage(slug: string, query: ArchiveCursorQuery = {}): Promise<FamilyArchivePageData | null> {
  const cursor = normalizeArchiveCursor(query);
  const family = await prisma.family.findUnique({
    where: { slug }, select: { id: true, slug: true, title: true, people: fallbackPerson },
  });
  if (!family) return null;

  // Range comparisons survive a restored/deleted anchor; Prisma cursor lookup
  // would otherwise lose the page when that record is no longer archived.
  const rows = await prisma.person.findMany({
    where: { familyId: family.id, isArchived: true,
      ...(cursor.after ? { id: { gt: cursor.after } } : cursor.before ? { id: { lt: cursor.before } } : {}),
    },
    orderBy: { id: cursor.before ? "desc" : "asc" },
    take: ARCHIVE_PAGE_SIZE + 1,
    select: archivePersonSelect,
  });
  const hasMore = rows.length > ARCHIVE_PAGE_SIZE;
  const page = rows.slice(0, ARCHIVE_PAGE_SIZE);
  if (cursor.before) page.reverse();
  const first = page[0]?.id;
  const last = page.at(-1)?.id;
  return {
    slug: family.slug, title: family.title, people: family.people,
    archivedPeople: page.map((person) => ({
      id: person.id, firstName: person.firstName, lastName: person.lastName,
      middleName: person.middleName || undefined, birthDate: person.birthDate,
      birthPlace: person.birthPlace, status: person.status, biography: person.biography,
      media: { photos: person.photosCount, audio: person.audioCount, documents: person.documentsCount },
    })),
    pagination: {
      previousCursor: cursor.after ? first ?? cursor.after : cursor.before && hasMore ? first ?? null : null,
      nextCursor: cursor.before ? last ?? cursor.before : hasMore ? last ?? null : null,
      isFiltered: Boolean(cursor.after || cursor.before),
    },
  };
}

/** Journal rendering needs no family graph, personal content or attachment metadata. */
export async function getFamilyJournalPage(slug: string): Promise<FamilyJournalPageData | null> {
  const family = await prisma.family.findUnique({
    where: { slug },
    select: {
      slug: true, title: true, people: fallbackPerson,
      auditLogs: {
        take: 100, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, actorName: true, message: true, personName: true, createdAt: true },
      },
    },
  });
  if (!family) return null;
  return {
    slug: family.slug, title: family.title, people: family.people,
    auditLog: family.auditLogs.map((entry) => ({
      id: entry.id, actorName: entry.actorName, message: entry.message,
      personName: entry.personName ?? undefined, createdAt: entry.createdAt.toISOString(),
    })),
  };
}
