import { ForgotPasswordForm } from "@/components/account-forms";
import { AuthShell } from "@/components/auth-shell";
import { SiteHeader } from "@/components/site-header";

export default function ForgotPasswordPage() {
  return <main className="page-shell">
    <SiteHeader compact />
    <AuthShell eyebrow="Восстановление доступа" title="Забыли пароль?" description="Укажите электронную почту своего аккаунта." asideTitle="Вернитесь к семейной истории" asideText="Если восстановление доступно, письмо поможет установить новый пароль." points={["Одноразовая ссылка с ограниченным сроком действия", "После смены пароля прежние сеансы завершатся"]} footerText="Вспомнили пароль?" footerLinkHref="/login" footerLinkLabel="Войти">
      <ForgotPasswordForm />
    </AuthShell>
  </main>;
}
