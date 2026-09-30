import { TokenActionForm } from "@/components/account-forms";
import { AuthShell } from "@/components/auth-shell";
import { SiteHeader } from "@/components/site-header";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AcceptInvitationPage() {
  const user = await getCurrentUser();
  return <main className="page-shell">
    <SiteHeader compact />
    <AuthShell eyebrow="Приглашение в семью" title="Присоединитесь к семейному архиву" description="Приглашение нужно принять с аккаунта, которому адресовано письмо." asideTitle="Историю сохраняют вместе" asideText="После принятия семья появится в вашем списке семей." points={["Нужен подтверждённый адрес получателя", "Роль доступа задаёт пригласивший вас родственник"]} footerText="Ваши семейные пространства" footerLinkHref="/families" footerLinkLabel="Мои семьи">
      <TokenActionForm authenticated={Boolean(user)} email={user?.email} emailVerified={Boolean(user?.emailVerifiedAt)} kind="invitation" />
    </AuthShell>
  </main>;
}
