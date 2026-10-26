import { notFound, redirect } from "next/navigation";
import {
  getCurrentUser,
  getFamilyRoleForUserId,
  normalizeSafeRedirectPath,
} from "@/lib/auth";
import { FamilyArchive } from "@/components/family-archive";
import { SiteHeader } from "@/components/site-header";
import { getFamilyArchivePage, normalizeArchiveCursor, type ArchiveCursorQuery } from "@/lib/family-archive-reader";

export const dynamic = "force-dynamic";

type FamilyArchivePageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<ArchiveCursorQuery>;
};

export default async function FamilyArchivePage({ params, searchParams }: FamilyArchivePageProps) {
  const { slug } = await params;
  const cursor = normalizeArchiveCursor(await searchParams);
  const query = new URLSearchParams(cursor).toString();
  const currentUser = await getCurrentUser();
  const redirectPath = normalizeSafeRedirectPath(`/family/${encodeURIComponent(slug)}/archive${query ? `?${query}` : ""}`);

  if (!currentUser) {
    redirect(`/login?redirectTo=${encodeURIComponent(redirectPath)}`);
  }

  const viewerRole = await getFamilyRoleForUserId(currentUser.id, slug);

  if (!viewerRole) {
    notFound();
  }

  const family = await getFamilyArchivePage(slug, cursor);

  if (!family) {
    notFound();
  }

  const fallbackPersonId = family.people[0]?.id;
  const canManage = viewerRole === "owner" || viewerRole === "admin" || viewerRole === "editor";
  const backHref = fallbackPersonId
    ? `/family/${family.slug}?person=${fallbackPersonId}`
    : `/family/${family.slug}`;

  return (
    <main className="page-shell">
      <SiteHeader compact />
      <FamilyArchive backHref={backHref} canManage={canManage} family={family} pagination={family.pagination} />
    </main>
  );
}
