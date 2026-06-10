import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { SiteHeader } from "@/components/site-header";

type RegisterPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const currentUser = await getCurrentUser();

  if (currentUser) {
    redirect("/onboarding/family");
  }

  const { error } = await searchParams;

  return (
    <main className="page-shell">
      <SiteHeader compact />
      <AuthShell
        eyebrow="Регистрация"
        title="Создайте аккаунт для вашей семьи"
        description="Сначала пользователь создает личный аккаунт, затем открывает свое семейное пространство и начинает собирать древо."
        asideTitle="Что получит семья"
        asideText="После регистрации можно создать семью, пригласить родственников и начать наполнять архив без дублирования людей."
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
              <input defaultValue="Тимур" name="firstName" />
            </label>
            <label className="form-field">
              <span>Фамилия</span>
              <input defaultValue="Ахмедов" name="lastName" />
            </label>
          </div>
          <label className="form-field">
            <span>Email</span>
            <input defaultValue="timur@rodovo.app" name="email" type="email" />
          </label>
          <label className="form-field">
            <span>Пароль</span>
            <input defaultValue="12345678" name="password" type="password" />
          </label>
          {error ? <p className="form-message error">{error}</p> : null}
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
