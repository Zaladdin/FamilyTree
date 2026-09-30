import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";

type SiteHeaderProps = {
  compact?: boolean;
};

export async function SiteHeader({ compact = false }: SiteHeaderProps) {
  const currentUser = await getCurrentUser();

  return (
    <header className={`site-header${compact ? " compact" : ""}`}>
      <Link aria-label="Rodovo — на главную" className="brand" href="/">
        <svg aria-hidden="true" className="brand-mark" viewBox="0 0 38 44" fill="none">
          <path d="M19 40V24M19 24C19 17 7 19 7 10M19 24C19 17 31 19 31 10M19 24V8" />
          <circle cx="7" cy="7" r="3" />
          <circle cx="19" cy="5" r="3" />
          <circle cx="31" cy="7" r="3" />
          <path d="M13 40H25" />
        </svg>
        <span>
          <strong>Rodovo</strong>
          <small>семейный архив</small>
        </span>
      </Link>

      <nav aria-label="Основная навигация" className="top-nav">
        {!compact && (
          <>
            <Link className="header-explore" href="/#features">Возможности</Link>
            <Link className="header-explore" href="/demo">Посмотреть пример</Link>
          </>
        )}
        {currentUser ? (
          <>
            <Link href="/families">Мои семьи</Link>
            <Link className="header-account" href="/account">
              Аккаунт: {currentUser.firstName}
            </Link>
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
              Начать историю
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
