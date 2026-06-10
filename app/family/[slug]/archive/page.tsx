import { notFound, redirect } from "next/navigation";
import {
  getCurrentUser,
  getFamilyRoleForUserId,
  normalizeSafeRedirectPath,
} from "@/lib/auth";
import { FamilyArchive } from "@/components/family-archive";
import { SiteHeader } from "@/components/site-header";
import { getFamilyBySlug } from "@/lib/family-repository";

export const dynamic = "force-dynamic";

type FamilyArchivePageProps = {
  params: Promise<{ slug: string }>;
};

export default async function FamilyArchivePage({ params }: FamilyArchivePageProps) {
  const { slug } = await params;
  const currentUser = await getCurrentUser();
  const redirectPath = normalizeSafeRedirectPath(`/family/${slug}/archive`);

  if (!currentUser) {
    redirect(`/login?redirectTo=${encodeURIComponent(redirectPath)}`);
  }

  const viewerRole = await getFamilyRoleForUserId(currentUser.id, slug);

  if (!viewerRole) {
    notFound();
  }

  const family = await getFamilyBySlug(slug);

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
      <FamilyArchive backHref={backHref} canManage={canManage} family={family} />
    </main>
  );
}
