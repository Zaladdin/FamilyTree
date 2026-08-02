import { notFound, redirect } from "next/navigation";
import { FamilyMembers } from "@/components/family-members";
import { SiteHeader } from "@/components/site-header";
import {
  getCurrentUser,
  getFamilyRoleForUserId,
  normalizeSafeRedirectPath,
} from "@/lib/auth";
import { getFamilyMembersPageData } from "@/lib/family-members";

export const dynamic = "force-dynamic";

type FamilyMembersPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function FamilyMembersPage({ params }: FamilyMembersPageProps) {
  const { slug } = await params;
  const currentUser = await getCurrentUser();
  const redirectPath = normalizeSafeRedirectPath(`/family/${slug}/members`);

  if (!currentUser) {
    redirect(`/login?redirectTo=${encodeURIComponent(redirectPath)}`);
  }

  const viewerRole = await getFamilyRoleForUserId(currentUser.id, slug);

  if (!viewerRole) {
    notFound();
  }

  const pageData = await getFamilyMembersPageData(slug, currentUser.id);

  if (!pageData) {
    notFound();
  }

  return (
    <main className="page-shell">
      <SiteHeader compact />
      <FamilyMembers
        backHref={`/family/${slug}`}
        familyTitle={pageData.familyTitle}
        members={pageData.members}
        slug={slug}
        viewerRole={viewerRole}
      />
    </main>
  );
}
