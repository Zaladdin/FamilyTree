import { NextResponse } from "next/server";
import { createSession, registerUser, setSessionCookie } from "@/lib/auth";
import { HttpError } from "@/lib/http-error";
import { parseAuthFormField } from "@/lib/request-validation";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const firstName = parseAuthFormField(formData.get("firstName"), "Имя");
    const lastName = parseAuthFormField(formData.get("lastName"), "Фамилия");
    const email = parseAuthFormField(formData.get("email"), "Email");
    const password = parseAuthFormField(formData.get("password"), "Пароль");

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

    return NextResponse.redirect(new URL("/onboarding/family", request.url));
  } catch (error) {
    const message =
      error instanceof HttpError || error instanceof Error
        ? error.message
        : "Не удалось создать аккаунт.";

    return NextResponse.redirect(
      new URL(`/register?error=${encodeURIComponent(message)}`, request.url),
    );
  }
}
