import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthShell } from "@/components/auth-shell";
import { FamilyOnboardingForm } from "@/components/family-onboarding-form";
import { SiteHeader } from "@/components/site-header";

export default async function FamilyOnboardingPage() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    redirect("/login?redirectTo=%2Fonboarding%2Ffamily");
  }

  return (
    <main className="page-shell">
      <SiteHeader compact />
      <AuthShell
        eyebrow="Шаг 2 из 3"
        title="Создайте семейное пространство"
        description="После регистрации пользователь создает семью: задает фамилию рода, название архива и определяет, кто будет первым человеком в дереве."
        asideTitle="Почему это отдельный шаг"
        asideText="Семья — это отдельное пространство данных. Один пользователь может быть участником нескольких семей, но у каждой семьи свои люди, медиа и права доступа."
        points={[
          "Изоляция данных между семьями",
          "Приглашение родственников по ссылке",
          "Подготовка дерева до наполнения людьми и связями",
        ]}
        footerText="Хотите вернуться?"
        footerLinkHref="/families"
        footerLinkLabel="К моим семьям"
      >
        <FamilyOnboardingForm
          defaultDescription="Семейный архив с древом рода, фотографиями и голосовыми историями старших поколений."
          defaultRegion="Баку, Губа, Дагестан"
          defaultSurname={currentUser.lastName.endsWith("а") ? `${currentUser.lastName.slice(0, -1)}ы` : `${currentUser.lastName}ы`}
          defaultTitle={`Род ${currentUser.lastName}${currentUser.lastName.endsWith("а") ? "ых" : "ых"}`}
        />
      </AuthShell>
    </main>
  );
}
