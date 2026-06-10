import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { UserFamilies } from "@/components/user-families";
import { getCurrentUser } from "@/lib/auth";
import { listFamiliesForUser } from "@/lib/family-admin-repository";

export const dynamic = "force-dynamic";

export default async function FamiliesPage() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    redirect("/login");
  }

  const families = await listFamiliesForUser(currentUser.id);

  return (
    <main className="page-shell">
      <SiteHeader compact />
      <UserFamilies
        currentUserName={`${currentUser.firstName} ${currentUser.lastName}`}
        families={families}
      />
    </main>
  );
}
