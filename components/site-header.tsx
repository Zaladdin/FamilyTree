import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";

type SiteHeaderProps = {
  compact?: boolean;
};

export async function SiteHeader({ compact = false }: SiteHeaderProps) {
  const currentUser = await getCurrentUser();

  return (
    <header className={`site-header${compact ? " compact" : ""}`}>
      <Link className="brand" href="/">
        <span className="brand-mark">R</span>
        <span>
          <strong>Rodovo</strong>
          <small>семейный архив</small>
        </span>
      </Link>

      <nav className="top-nav">
        {!compact && (
          <>
            <a href="#features">Возможности</a>
            <Link href="/family/akhmedov?person=timur">Демо-семья</Link>
          </>
        )}
        {currentUser ? (
          <>
            <Link href="/families">Мои семьи</Link>
            <span className="header-user">
              {currentUser.firstName} {currentUser.lastName}
            </span>
            <form action="/api/auth/logout" method="post">
              <button className="ghost-button" type="submit">
                Выйти
              </button>
            </form>
          </>
        ) : (
          <>
            <Link className="ghost-button" href="/login">
              Войти
            </Link>
            <Link className="accent-button" href="/register">
              Регистрация
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
