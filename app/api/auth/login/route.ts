import { NextResponse } from "next/server";
import {
  authenticateUser,
  createSession,
  normalizeSafeRedirectPath,
  setSessionCookie,
} from "@/lib/auth";
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

    const formData = await request.formData();
    const email = parseAuthFormField(formData.get("email"), "Email");
    const password = parseAuthPassword(formData.get("password"));

    // Per-account limit: caps brute force against a single email regardless
    // of how many IPs the attacker uses.
    await enforceRateLimit({
      key: `login:email:${email.trim().toLowerCase()}`,
      limit: 10,
      windowMs: 5 * 60 * 1000,
      message: "Слишком много попыток входа.",
    });

    // Per-IP limit when the client IP is known; otherwise a wide shared
    // backstop that catches floods without letting one client lock out logins
    // for everyone.
    const clientIp = getClientIp(request);
    await enforceRateLimit({
      key: clientIp ? `login:ip:${clientIp}` : "login:global",
      limit: clientIp ? 10 : 300,
      windowMs: 5 * 60 * 1000,
      message: "Слишком много попыток входа.",
    });
    const redirectTo = normalizeSafeRedirectPath(
      typeof formData.get("redirectTo") === "string"
        ? String(formData.get("redirectTo"))
        : null,
      "/families",
    );

    const user = await authenticateUser(email, password);
    const session = await createSession(user.id);
    await setSessionCookie(session.token, session.expiresAt);

    return NextResponse.redirect(new URL(redirectTo, request.url), 303);
  } catch (error) {
    const message =
      error instanceof HttpError || error instanceof Error
        ? error.message
        : "Не удалось выполнить вход.";

    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(message)}`, request.url),
      303,
    );
  }
}
