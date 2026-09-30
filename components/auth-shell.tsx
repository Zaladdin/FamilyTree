import Link from "next/link";

type AuthShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  asideTitle: string;
  asideText: string;
  points: string[];
  children: React.ReactNode;
  footerText: string;
  footerLinkHref: string;
  footerLinkLabel: string;
};

export function AuthShell({
  eyebrow,
  title,
  description,
  asideTitle,
  asideText,
  points,
  children,
  footerText,
  footerLinkHref,
  footerLinkLabel,
}: AuthShellProps) {
  return (
    <section className="auth-layout" aria-labelledby="auth-title">
      <article className="auth-panel">
        <div className="eyebrow">{eyebrow}</div>
        <h1 id="auth-title">{title}</h1>
        <p className="hero-text">{description}</p>
        {children}
        <p className="form-footer">
          {footerText} <Link href={footerLinkHref}>{footerLinkLabel}</Link>
        </p>
      </article>

      <aside className="info-rail auth-story-rail">
        <div aria-hidden="true" className="auth-thread-illustration">
          <svg viewBox="0 0 320 200" fill="none">
            <path d="M160 186V148M160 148H79V87M160 148H241V87M79 87H38V43M79 87H120V43M241 87H200V43M241 87H282V43" />
            <rect x="17" y="11" width="42" height="32" />
            <rect x="99" y="11" width="42" height="32" />
            <rect x="179" y="11" width="42" height="32" />
            <rect x="261" y="11" width="42" height="32" />
            <rect x="51" y="66" width="56" height="43" />
            <rect x="213" y="66" width="56" height="43" />
            <rect x="128" y="125" width="64" height="48" />
          </svg>
          <span>У каждой истории есть продолжение</span>
        </div>
        <div className="eyebrow">Место для вашей семьи</div>
        <h2>{asideTitle}</h2>
        <p>{asideText}</p>
        <ul className="feature-list">
          {points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </aside>
    </section>
  );
}
