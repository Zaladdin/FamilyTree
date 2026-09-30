type SecurityHeader = {
  key: string;
  value: string;
};

// Next.js development bundles use eval for debugging. Never enable it outside
// development: https://nextjs.org/docs/15/app/guides/content-security-policy#development-environment
export function getSecurityHeaders(nodeEnv: string | undefined): SecurityHeader[] {
  const isDevelopment = nodeEnv === "development";

  // Preserve the existing inline-script/style policy for App Router hydration.
  // Migrating production to nonce-based CSP is a separate hardening task.
  const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    },
  ];
}
