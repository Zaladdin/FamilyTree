import { withObservedRoute } from "@/lib/observability";
import { NextResponse } from "next/server";
import {
  authenticateUser,
  createSession,
  normalizeSafeRedirectPath,
  setSessionCookie,
} from "@/lib/auth";
import { authErrorMessage } from "@/lib/auth-error";
import {
  assertSameOrigin,
  parseAuthFormField,
  parseAuthPassword,
} from "@/lib/request-validation";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";
import { getRequestOrigin } from "@/lib/request-origin";

async function handlePOST(request: Request) {
  let redirectTo = "/families";

  try {
    assertSameOrigin(request);

    const formData = await request.formData();
    redirectTo = normalizeSafeRedirectPath(
      typeof formData.get("redirectTo") === "string"
        ? String(formData.get("redirectTo"))
        : null,
      "/families",
    );
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
    const user = await authenticateUser(email, password);
    const session = await createSession(user.id, user.sessionVersion);
    await setSessionCookie(session.token, session.expiresAt);

    return NextResponse.redirect(new URL(redirectTo, getRequestOrigin(request)), 303);
  } catch (error) {
    const message = authErrorMessage(error, "Не удалось выполнить вход. Попробуйте позже.");

    const query = new URLSearchParams({ error: message, redirectTo });
    return NextResponse.redirect(new URL(`/login?${query}`, getRequestOrigin(request)), 303);
  }
}

export const POST = withObservedRoute("/api/auth/login", handlePOST);
