import test from "node:test";
import assert from "node:assert/strict";
import nextConfig from "../next.config";
import { getSecurityHeaders } from "@/lib/security-headers";

const productionPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
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

function getPolicy(nodeEnv: string | undefined): string {
  const policy = getSecurityHeaders(nodeEnv).find(
    (header) => header.key === "Content-Security-Policy",
  );
  assert.ok(policy, "Content-Security-Policy header must be present");
  return policy.value;
}

test("development allows eval-based Next.js debugging only in script-src", () => {
  const policy = getPolicy("development");

  assert.equal(
    policy.split("; ").find((directive) => directive.startsWith("script-src ")),
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  );
  assert.equal(policy.replace(" 'unsafe-eval'", ""), productionPolicy);
  assert.equal(policy.match(/'unsafe-eval'/g)?.length, 1);
});

test("production and every non-development environment preserve the original policy", () => {
  for (const nodeEnv of ["production", "test", undefined, "", "dev", "Development"]) {
    const policy = getPolicy(nodeEnv);
    assert.equal(policy, productionPolicy, `unexpected policy for ${String(nodeEnv)}`);
    assert.ok(!policy.includes("'unsafe-eval'"));
  }
});

test("all other security headers remain unchanged in development and production", () => {
  const expected = [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    },
  ];

  for (const nodeEnv of ["development", "production"]) {
    const headers = getSecurityHeaders(nodeEnv);
    assert.equal(headers.length, expected.length + 1);
    assert.deepEqual(headers.filter((header) => header.key !== "Content-Security-Policy"), expected);
  }
});

test("Next.js applies the environment-specific headers to every route", async () => {
  assert.ok(nextConfig.headers);
  assert.equal(nextConfig.reactStrictMode, true);
  assert.deepEqual(await nextConfig.headers(), [
    {
      source: "/:path*",
      headers: getSecurityHeaders(process.env.NODE_ENV),
    },
  ]);
});
