import { cookies } from "next/headers";
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { FamilyRole } from "@/lib/types";
import { HttpError } from "@/lib/http-error";
import { prisma } from "@/lib/prisma";

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE_NAME = "rodovo_session";
const SESSION_TTL_DAYS = 14;

type AuthUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
};

// Pragmatic email shape check: single @, non-empty local part, dotted domain,
// no whitespace. Not RFC-exhaustive, but rejects obviously invalid input.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function assertValidEmail(email: string) {
  const normalized = normalizeEmail(email);

  if (normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
    throw new HttpError(400, "Укажите корректный email.");
  }

  return normalized;
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeSafeRedirectPath(
  redirectTo: string | null | undefined,
  fallback = "/families",
) {
  if (typeof redirectTo !== "string") {
    return fallback;
  }

  const normalized = redirectTo.trim();
  const lowerCased = normalized.toLowerCase();

  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return fallback;
  }

  if (
    normalized.includes("\\") ||
    /[\r\n\t]/.test(normalized) ||
    lowerCased.includes("%2f") ||
    lowerCased.includes("%5c")
  ) {
    return fallback;
  }

  return normalized;
}

export async function getFamilyRoleForUserId(userId: string, slug: string) {
  const membership = await prisma.familyMembership.findFirst({
    where: {
      family: { slug },
      userId,
    },
    select: {
      role: true,
    },
  });

  return membership?.role ?? null;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [salt, hash] = storedHash.split(":");

  if (!salt || !hash) {
    return false;
  }

  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const storedBuffer = Buffer.from(hash, "hex");

  if (derived.length !== storedBuffer.length) {
    return false;
  }

  return timingSafeEqual(derived, storedBuffer);
}

export async function purgeExpiredSessions() {
  return prisma.session.deleteMany({
    where: {
      expiresAt: { lte: new Date() },
    },
  });
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      tokenHash,
      userId,
      expiresAt,
    },
  });

  // Best-effort housekeeping so the sessions table does not grow unbounded.
  // Failures here must not block sign-in.
  await purgeExpiredSessions().catch(() => undefined);

  return { token, expiresAt };
}

export async function destroySession(token: string) {
  const tokenHash = hashSessionToken(token);
  await prisma.session.deleteMany({
    where: { tokenHash },
  });
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
}

export async function getCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const tokenHash = hashSessionToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: {
      user: true,
    },
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await destroySession(token);
    await clearSessionCookie();
    return null;
  }

  return session;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = await getCurrentSession();

  if (!session) {
    return null;
  }

  return {
    id: session.user.id,
    firstName: session.user.firstName,
    lastName: session.user.lastName,
    email: session.user.email,
  };
}

export async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    throw new HttpError(401, "Нужно войти в аккаунт, чтобы менять семейный архив.");
  }

  return user;
}

export async function getViewerRoleForFamily(slug: string) {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  return getFamilyRoleForUserId(user.id, slug);
}

export async function requireFamilyRole(slug: string, allowedRoles: FamilyRole[]) {
  const user = await requireUser();
  const role = await getFamilyRoleForUserId(user.id, slug);

  if (!role) {
    throw new HttpError(403, "У вас нет доступа к этой семье.");
  }

  if (!allowedRoles.includes(role)) {
    throw new HttpError(403, "Недостаточно прав для этого действия.");
  }

  return {
    user,
    role,
  };
}

export async function authenticateUser(email: string, password: string) {
  const normalizedEmail = normalizeEmail(email);
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    throw new HttpError(401, "Неверный email или пароль.");
  }

  const isValid = await verifyPassword(password, user.passwordHash);

  if (!isValid) {
    throw new HttpError(401, "Неверный email или пароль.");
  }

  return user;
}

export async function registerUser(params: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}) {
  const email = assertValidEmail(params.email);
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingUser) {
    throw new HttpError(409, "Аккаунт с таким email уже существует.");
  }

  return prisma.user.create({
    data: {
      firstName: params.firstName.trim(),
      lastName: params.lastName.trim(),
      email,
      passwordHash: await hashPassword(params.password),
    },
  });
}
