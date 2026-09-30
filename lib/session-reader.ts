import { createHash } from "node:crypto";

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Read-only so it is safe to use from Server Components as well as routes. */
export async function readValidSession<Session extends { expiresAt: Date; sessionVersion?: number; user?: { sessionVersion?: number } }>(
  token: string | undefined,
  findByTokenHash: (tokenHash: string) => Promise<Session | null>,
  now: number = Date.now(),
): Promise<Session | null> {
  if (!token) return null;

  const session = await findByTokenHash(hashSessionToken(token));
  if (!session || !(session.expiresAt.getTime() > now)) return null;
  // A login can finish after a password reset has deleted the old rows. Its
  // credential generation remains stale, so it must never become valid again.
  if ((session.sessionVersion ?? 0) !== (session.user?.sessionVersion ?? 0)) return null;

  return session;
}
