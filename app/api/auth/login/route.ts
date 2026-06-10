import { NextResponse } from "next/server";
import {
  authenticateUser,
  createSession,
  normalizeSafeRedirectPath,
  setSessionCookie,
} from "@/lib/auth";
import { HttpError } from "@/lib/http-error";
import { parseAuthFormField } from "@/lib/request-validation";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const email = parseAuthFormField(formData.get("email"), "Email");
    const password = parseAuthFormField(formData.get("password"), "Пароль");
    const redirectTo = normalizeSafeRedirectPath(
      typeof formData.get("redirectTo") === "string"
        ? String(formData.get("redirectTo"))
        : null,
      "/families",
    );

    const user = await authenticateUser(email, password);
    const session = await createSession(user.id);
    await setSessionCookie(session.token, session.expiresAt);

    return NextResponse.redirect(new URL(redirectTo, request.url));
  } catch (error) {
    const message =
      error instanceof HttpError || error instanceof Error
        ? error.message
        : "Не удалось выполнить вход.";

    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(message)}`, request.url),
    );
  }
}
