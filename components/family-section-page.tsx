import { notFound, redirect } from "next/navigation";
import { FamilyApp } from "@/components/family-app";
import { getCurrentUser, getFamilyRoleForUserId, normalizeSafeRedirectPath } from "@/lib/auth";
import { getFamilyWorkspaceBySlug } from "@/lib/family-workspace-reader";

export type FamilySectionPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ person?: string }>;
};

export async function FamilySectionPage({
  params,
  searchParams,
  section,
}: FamilySectionPageProps & { section: "people" | "memories" | "photos" }) {
  const { slug } = await params;
  const { person } = await searchParams;
  const currentUser = await getCurrentUser();
  const redirectPath = normalizeSafeRedirectPath(
    `/family/${encodeURIComponent(slug)}/${section}${person ? `?person=${encodeURIComponent(person)}` : ""}`,
  );

  if (!currentUser) {
    redirect(`/login?redirectTo=${encodeURIComponent(redirectPath)}`);
  }

  const viewerRole = await getFamilyRoleForUserId(currentUser.id, slug);
  if (!viewerRole) notFound();

  const canEdit = viewerRole === "owner" || viewerRole === "admin" || viewerRole === "editor";
  const family = await getFamilyWorkspaceBySlug(slug, person, { canEdit });
  if (!family) notFound();

  const focusPersonId = person && family.people.some((candidate) => candidate.id === person)
    ? person
    : null;

  return (
    <main className="family-workspace-page">
      <FamilyApp canEdit={canEdit} initialFamily={family} initialFocusPersonId={focusPersonId} section={section} />
    </main>
  );
}
