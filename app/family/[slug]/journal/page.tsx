import { notFound, redirect } from "next/navigation";
import { FamilyJournal } from "@/components/family-journal";
import { SiteHeader } from "@/components/site-header";
import {
  getCurrentUser,
  getFamilyRoleForUserId,
  normalizeSafeRedirectPath,
} from "@/lib/auth";
import { getFamilyJournalBySlug } from "@/lib/family-repository";

export const dynamic = "force-dynamic";

type FamilyJournalPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function FamilyJournalPage({ params }: FamilyJournalPageProps) {
  const { slug } = await params;
  const currentUser = await getCurrentUser();
  const redirectPath = normalizeSafeRedirectPath(`/family/${slug}/journal`);

  if (!currentUser) {
    redirect(`/login?redirectTo=${encodeURIComponent(redirectPath)}`);
  }

  const viewerRole = await getFamilyRoleForUserId(currentUser.id, slug);

  if (!viewerRole) {
    notFound();
  }

  const family = await getFamilyJournalBySlug(slug);

  if (!family) {
    notFound();
  }

  const fallbackPersonId = family.people[0]?.id;
  const backHref = fallbackPersonId
    ? `/family/${family.slug}?person=${fallbackPersonId}`
    : `/family/${family.slug}`;

  return (
    <main className="page-shell">
      <SiteHeader compact />
      <FamilyJournal backHref={backHref} family={family} />
    </main>
  );
}
