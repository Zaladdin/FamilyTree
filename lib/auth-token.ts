import { createHash, randomBytes } from "node:crypto";
import { HttpError } from "@/lib/http-error";

export type AuthTokenLifetime = "verify_email" | "password_reset" | "invitation";

export function generateAuthToken() {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: hashAuthToken(token) };
}

export function hashAuthToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function parseAuthToken(token: unknown): string {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
    throw new HttpError(400, "Ссылка недействительна или срок её действия истёк.");
  }
  return token;
}

export function authTokenExpiry(purpose: AuthTokenLifetime, now = new Date()) {
  const settings = {
    verify_email: { key: "AUTH_VERIFY_EMAIL_TTL_SECONDS", seconds: 86400 },
    password_reset: { key: "AUTH_PASSWORD_RESET_TTL_SECONDS", seconds: 1800 },
    invitation: { key: "AUTH_INVITATION_TTL_SECONDS", seconds: 604800 },
  }[purpose];
  const configured = process.env[settings.key];
  const seconds = configured === undefined ? settings.seconds : Number(configured);
  if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 31 * 86400) {
    throw new Error(`Invalid ${settings.key} TTL configuration.`);
  }
  return new Date(now.getTime() + seconds * 1000);
}
