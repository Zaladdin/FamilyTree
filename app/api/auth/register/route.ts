import { NextResponse } from "next/server";
import { createSession, registerUser, setSessionCookie } from "@/lib/auth";
import { HttpError } from "@/lib/http-error";
import {
  assertSameOrigin,
  parseAuthFormField,
  parseAuthPassword,
} from "@/lib/request-validation";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);

    // Per-IP limit when the client IP is known; otherwise a wider shared
    // backstop — registration has no per-target key (the attacker controls the
    // email), so without a trusted IP this only throttles mass signups.
    const clientIp = getClientIp(request);
    await enforceRateLimit({
      key: clientIp ? `register:ip:${clientIp}` : "register:global",
      limit: clientIp ? 5 : 30,
      windowMs: 15 * 60 * 1000,
      message: "Слишком много попыток регистрации.",
    });

    const formData = await request.formData();
    const firstName = parseAuthFormField(formData.get("firstName"), "Имя");
    const lastName = parseAuthFormField(formData.get("lastName"), "Фамилия");
    const email = parseAuthFormField(formData.get("email"), "Email");
    const password = parseAuthPassword(formData.get("password"));

    if (password.length < 8) {
      throw new HttpError(400, "Пароль должен быть не короче 8 символов.");
    }

    const user = await registerUser({
      firstName,
      lastName,
      email,
      password,
    });

    const session = await createSession(user.id);
    await setSessionCookie(session.token, session.expiresAt);

    return NextResponse.redirect(new URL("/onboarding/family", request.url), 303);
  } catch (error) {
    const message =
      error instanceof HttpError || error instanceof Error
        ? error.message
        : "Не удалось создать аккаунт.";

    return NextResponse.redirect(
      new URL(`/register?error=${encodeURIComponent(message)}`, request.url),
      303,
    );
  }
}
