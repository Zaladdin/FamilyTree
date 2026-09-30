import { withObservedRoute } from "@/lib/observability";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clearSessionCookie, destroySession, getCurrentSession } from "@/lib/auth";
import { HttpError } from "@/lib/http-error";
import { assertSameOrigin } from "@/lib/request-validation";
import { getRequestOrigin } from "@/lib/request-origin";

async function handlePOST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch (error) {
    const message =
      error instanceof HttpError ? error.message : "Недопустимый источник запроса.";
    return NextResponse.json({ error: message }, { status: 403 });
  }

  const session = await getCurrentSession();
  const cookieStore = await cookies();
  const token = cookieStore.get("rodovo_session")?.value;

  if (session && token) {
    await destroySession(token);
  }

  await clearSessionCookie();

  return NextResponse.redirect(new URL("/login", getRequestOrigin(request)), 303);
}

export const POST = withObservedRoute("/api/auth/logout", handlePOST);
