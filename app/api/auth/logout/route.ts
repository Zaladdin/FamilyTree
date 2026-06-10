import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clearSessionCookie, destroySession, getCurrentSession } from "@/lib/auth";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  const cookieStore = await cookies();
  const token = cookieStore.get("rodovo_session")?.value;

  if (session && token) {
    await destroySession(token);
  }

  await clearSessionCookie();

  return NextResponse.redirect(new URL("/login", request.url));
}
