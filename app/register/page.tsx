import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthShell } from "@/components/auth-shell";
import { SiteHeader } from "@/components/site-header";

type RegisterPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const currentUser = await getCurrentUser();

  if (currentUser) {
    redirect("/account");
  }

  const { error } = await searchParams;

  return (
    <main className="page-shell">
      <SiteHeader compact />
      <AuthShell
        eyebrow="Регистрация"
        title="Начните свою семейную историю"
        description="Создайте личный аккаунт, а затем добавьте свою семью. Начать можно с одного имени — вашего."
        asideTitle="Что получит семья"
        asideText="Соберите близких в одном пространстве. Сохраните имена, фотографии и воспоминания, которые хочется передать дальше."
        points={[
          "Карточка памяти на каждого человека",
          "Проверка дублей по ФИО и дате рождения",
          "Дерево, медиаархив и голосовые истории в одном интерфейсе",
        ]}
        footerText="Уже есть аккаунт?"
        footerLinkHref="/login"
        footerLinkLabel="Войти"
      >
        <form action="/api/auth/register" className="form-stack" method="post">
          <div className="form-grid">
            <label className="form-field">
              <span>Имя</span>
              <input autoComplete="given-name" name="firstName" required />
            </label>
            <label className="form-field">
              <span>Фамилия</span>
              <input autoComplete="family-name" name="lastName" required />
            </label>
          </div>
          <label className="form-field">
            <span>Электронная почта</span>
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <label className="form-field">
            <span>Пароль</span>
            <input autoComplete="new-password" minLength={8} name="password" required type="password" />
            <small>Не менее 8 символов</small>
          </label>
          {error ? <p className="form-message error" role="alert">{error}</p> : null}
          <div className="form-actions">
            <button className="primary-button" type="submit">
              Создать аккаунт
            </button>
          </div>
        </form>
      </AuthShell>
    </main>
  );
}
