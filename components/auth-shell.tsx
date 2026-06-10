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
    <section className="auth-layout">
      <article className="auth-panel">
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p className="hero-text">{description}</p>
        {children}
        <p className="form-footer">
          {footerText} <Link href={footerLinkHref}>{footerLinkLabel}</Link>
        </p>
      </article>

      <aside className="info-rail">
        <div className="eyebrow">Зачем это нужно</div>
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
