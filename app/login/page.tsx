import { redirect } from "next/navigation";
import { getCurrentUser, normalizeSafeRedirectPath } from "@/lib/auth";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { SiteHeader } from "@/components/site-header";

type LoginPageProps = {
  searchParams: Promise<{ error?: string; redirectTo?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, redirectTo } = await searchParams;
  const safeRedirectTo = normalizeSafeRedirectPath(redirectTo, "/families");
  const currentUser = await getCurrentUser();

  if (currentUser) {
    redirect(safeRedirectTo);
  }

  return (
    <main className="page-shell">
      <SiteHeader compact />
      <AuthShell
        eyebrow="Вход"
        title="Войдите в семейный архив"
        description="Откройте свое семейное пространство, продолжите наполнять древо и возвращайтесь к голосам памяти в одном месте."
        asideTitle="Один аккаунт, несколько семей"
        asideText="Пользователь может состоять в нескольких семейных пространствах: своей семье, семье супруги и отдельном архиве рода."
        points={[
          "Переход между семьями без повторной регистрации",
          "Роли доступа: владелец, редактор, участник, гость",
          "Вся история изменений сохраняется в журнале",
        ]}
        footerText="Еще нет аккаунта?"
        footerLinkHref="/register"
        footerLinkLabel="Зарегистрироваться"
      >
        <form action="/api/auth/login" className="form-stack" method="post">
          <label className="form-field">
            <span>Email</span>
            <input defaultValue="timur@rodovo.app" name="email" type="email" />
          </label>
          <label className="form-field">
            <span>Пароль</span>
            <input defaultValue="12345678" name="password" type="password" />
          </label>
          <input name="redirectTo" type="hidden" value={safeRedirectTo} />
          {error ? <p className="form-message error">{error}</p> : null}
          <div className="form-actions">
            <button className="primary-button" type="submit">
              Войти в аккаунт
            </button>
            <button className="ghost-button" type="button">
              Восстановить доступ
            </button>
          </div>
        </form>
      </AuthShell>
    </main>
  );
}
