import { redirect } from "next/navigation";
import { AccountSettings } from "@/components/account-forms";
import { SiteHeader } from "@/components/site-header";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=%2Faccount");

  return <main className="page-shell">
    <SiteHeader compact />
    <AccountSettings email={user.email} emailVerified={Boolean(user.emailVerifiedAt)} firstName={user.firstName} lastName={user.lastName} legacyAccount={user.legacyAccount} />
  </main>;
}
