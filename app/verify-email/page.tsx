import { TokenActionForm } from "@/components/account-forms";
import { AuthShell } from "@/components/auth-shell";
import { SiteHeader } from "@/components/site-header";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function VerifyEmailPage() {
  const user = await getCurrentUser();
  return <main className="page-shell">
    <SiteHeader compact />
    <AuthShell eyebrow="Электронная почта" title="Подтвердите свой адрес" description="Проверьте, что вы вошли в нужный аккаунт, и подтвердите почту." asideTitle="Почта для важных действий" asideText="Подтверждённый адрес позволяет восстанавливать доступ и принимать приглашения семьи." points={["Подтверждение выполняется только после вашего нажатия", "Войдите в аккаунт, которому адресовано письмо"]} footerText="Настройки почты и пароля" footerLinkHref="/account" footerLinkLabel="Мой аккаунт">
      <TokenActionForm authenticated={Boolean(user)} email={user?.email} kind="verify" />
    </AuthShell>
  </main>;
}
