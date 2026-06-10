import { notFound, redirect } from "next/navigation";
import { FamilyApp } from "@/components/family-app";
import { SiteHeader } from "@/components/site-header";
import {
  getCurrentUser,
  getFamilyRoleForUserId,
  normalizeSafeRedirectPath,
} from "@/lib/auth";
import { getFamilyBySlug } from "@/lib/family-repository";

export const dynamic = "force-dynamic";

type FamilyPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ person?: string }>;
};

export default async function FamilyPage({
  params,
  searchParams,
}: FamilyPageProps) {
  const { slug } = await params;
  const { person } = await searchParams;
  const currentUser = await getCurrentUser();
  const redirectPath = normalizeSafeRedirectPath(
    `/family/${slug}${person ? `?person=${encodeURIComponent(person)}` : ""}`,
  );

  if (!currentUser) {
    redirect(`/login?redirectTo=${encodeURIComponent(redirectPath)}`);
  }

  const viewerRole = await getFamilyRoleForUserId(currentUser.id, slug);

  if (!viewerRole) {
    notFound();
  }

  const family = await getFamilyBySlug(slug, person);

  if (!family) {
    notFound();
  }

  const fallbackPersonId = family.people[0]?.id;
  const focusPersonId = person ?? fallbackPersonId;
  const canEdit = viewerRole === "owner" || viewerRole === "admin" || viewerRole === "editor";

  return (
    <main className="page-shell">
      <SiteHeader compact />
      <FamilyApp canEdit={canEdit} initialFamily={family} initialFocusPersonId={focusPersonId} />
    </main>
  );
}
