import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, normalizeSafeRedirectPath } from "@/lib/auth";
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
        description="Рады видеть вас снова. Ваши близкие, фотографии и незаписанные истории уже ждут."
        asideTitle="Один аккаунт, несколько семей"
        asideText="Собирайте историю своей семьи и семьи любимого человека. Переключайтесь между архивами с одним аккаунтом."
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
            <span>Электронная почта</span>
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <label className="form-field">
            <span>Пароль</span>
            <input autoComplete="current-password" name="password" required type="password" />
          </label>
          <input name="redirectTo" type="hidden" value={safeRedirectTo} />
          <Link href="/forgot-password">Забыли пароль?</Link>
          {error ? <p className="form-message error" role="alert">{error}</p> : null}
          <div className="form-actions">
            <button className="primary-button" type="submit">
              Войти в аккаунт
            </button>
          </div>
        </form>
      </AuthShell>
    </main>
  );
}
