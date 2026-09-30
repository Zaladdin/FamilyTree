import { TokenActionForm } from "@/components/account-forms";
import { AuthShell } from "@/components/auth-shell";
import { SiteHeader } from "@/components/site-header";

export default function ResetPasswordPage() {
  return <main className="page-shell">
    <SiteHeader compact />
    <AuthShell eyebrow="Восстановление доступа" title="Новый пароль" description="Придумайте пароль и повторите его, чтобы избежать опечатки." asideTitle="Доступ под вашим контролем" asideText="После сохранения войдите с новым паролем." points={["Ссылка работает только один раз", "Все прежние сеансы будут завершены"]} footerText="Нужна новая ссылка?" footerLinkHref="/forgot-password" footerLinkLabel="Запросить письмо">
      <TokenActionForm authenticated={false} kind="reset" />
    </AuthShell>
  </main>;
}
