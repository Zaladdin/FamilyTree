import { NextResponse } from "next/server";
import { hashSessionToken } from "@/lib/session-reader";
import { authErrorMessage } from "@/lib/auth-error";
import { HttpError } from "@/lib/http-error";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";

export function accountJson(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export function accountError(error: unknown) {
  const status = error instanceof HttpError && error.status >= 400 && error.status < 500 ? error.status : 500;
  return accountJson({ error: authErrorMessage(error, "Не удалось выполнить действие. Попробуйте позже.") }, status);
}

export async function accountPayload(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try { body = await request.json(); } catch { throw new HttpError(400, "Некорректные данные запроса."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Некорректные данные запроса.");
  return body as Record<string, unknown>;
}

export function accountString(payload: Record<string, unknown>, field: string, maxLength = 200): string {
  const value = payload[field];
  if (typeof value !== "string" || !value.length || value.length > maxLength) throw new HttpError(400, "Заполните поля формы корректно.");
  return value;
}

export async function accountRateLimit(request: Request, action: string, target: string, limit = 5) {
  const windowMs = 15 * 60 * 1000;
  // Hash normalized emails and tokens before they reach any shared Redis keys.
  await enforceRateLimit({ key: `account:${action}:target:${hashSessionToken(target)}`, limit, windowMs });
  const ip = getClientIp(request);
  await enforceRateLimit({ key: ip ? `account:${action}:ip:${ip}` : `account:${action}:global`, limit: ip ? 30 : 300, windowMs });
}
