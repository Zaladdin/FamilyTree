import type { AuthTokenPurpose, Prisma, User } from "@prisma/client";
import { assertValidEmail, hashPassword, verifyPassword } from "@/lib/auth";
import { sendAuthEmail } from "@/lib/auth-mail";
import { authTokenExpiry, generateAuthToken, hashAuthToken, parseAuthToken } from "@/lib/auth-token";
import { HttpError } from "@/lib/http-error";
import { prisma } from "@/lib/prisma";
import { parseAuthPassword } from "@/lib/request-validation";
import { withSerializableTransaction } from "@/lib/serializable-transaction";

const invalidToken = () => new HttpError(400, "Ссылка недействительна или срок её действия истёк. Запросите новую ссылку.");
const staleCredentials = () => new HttpError(409, "Данные аккаунта изменились. Войдите снова и повторите действие.");

export function validateNewAccountPassword(password: unknown, confirmation: unknown): string {
  const parsed = parseAuthPassword(typeof password === "string" ? password : null);
  if (parsed.length < 8) throw new HttpError(400, "Пароль должен быть не короче 8 символов.");
  if (parsed !== confirmation) throw new HttpError(400, "Пароли не совпадают.");
  return parsed;
}

async function proveCurrentPassword(userId: string, currentPassword: string) {
  const password = parseAuthPassword(currentPassword);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(401, "Нужно войти в аккаунт.");
  if (!(await verifyPassword(password, user.passwordHash))) throw new HttpError(400, "Текущий пароль указан неверно.");
  return user;
}

async function requireUnchangedUser(tx: Prisma.TransactionClient, proof: User) {
  const user = await tx.user.findUnique({ where: { id: proof.id } });
  if (!user || user.passwordHash !== proof.passwordHash || user.sessionVersion !== proof.sessionVersion || user.email !== proof.email) {
    throw staleCredentials();
  }
  return user;
}

async function issueToken(proof: User, purpose: AuthTokenPurpose, send: typeof sendAuthEmail): Promise<boolean> {
  const secret = generateAuthToken();
  const row = await withSerializableTransaction(async (tx) => {
    const user = await requireUnchangedUser(tx, proof);
    // This is rechecked inside the transaction because verification or account
    // recovery policy may have changed while the request was in flight.
    if (purpose === "password_reset" && user.legacyAccount && !user.emailVerifiedAt) return null;
    const now = new Date();
    await tx.authToken.updateMany({ where: { userId: user.id, purpose, consumedAt: null }, data: { consumedAt: now } });
    return tx.authToken.create({ data: {
      tokenHash: secret.tokenHash, purpose, userId: user.id, email: user.email,
      sessionVersion: user.sessionVersion, expiresAt: authTokenExpiry(purpose, now),
    } });
  });
  if (!row) return false;
  // Delivery is outside the retryable transaction. Never log or return a token.
  const delivered = await send({ to: proof.email, kind: purpose, token: secret.token }).catch(() => false);
  if (!delivered) {
    await prisma.authToken.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
  }
  return delivered;
}

export async function requestPasswordReset(email: string, send = sendAuthEmail): Promise<void> {
  const normalizedEmail = assertValidEmail(email);
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  // Existing unverified accounts retain access, but mailbox possession alone
  // cannot take over a legacy archive whose mailbox may have been reassigned.
  if (!user || (user.legacyAccount && !user.emailVerifiedAt)) return;
  await issueToken(user, "password_reset", send);
}

export async function requestEmailVerification(input: { userId: string; currentPassword: string }, send = sendAuthEmail) {
  const user = await proveCurrentPassword(input.userId, input.currentPassword);
  if (user.emailVerifiedAt) throw new HttpError(409, "Адрес электронной почты уже подтверждён.");
  return { delivered: await issueToken(user, "verify_email", send) };
}

async function requireToken(tx: Prisma.TransactionClient, tokenHash: string, purpose: AuthTokenPurpose, now: Date) {
  const token = await tx.authToken.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!token || token.purpose !== purpose || token.consumedAt || !(token.expiresAt > now) ||
      token.email !== token.user.email || token.sessionVersion !== token.user.sessionVersion) throw invalidToken();
  return token;
}

async function consumeToken(tx: Prisma.TransactionClient, tokenId: string, now: Date) {
  const consumed = await tx.authToken.updateMany({
    where: { id: tokenId, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now },
  });
  if (consumed.count !== 1) throw invalidToken();
}

export async function confirmEmailVerification(input: { userId: string; token: string }): Promise<void> {
  const tokenHash = hashAuthToken(parseAuthToken(input.token));
  await withSerializableTransaction(async (tx) => {
    const now = new Date();
    const token = await requireToken(tx, tokenHash, "verify_email", now);
    if (token.userId !== input.userId) throw invalidToken();
    await consumeToken(tx, token.id, now);
    const result = await tx.user.updateMany({
      where: { id: token.userId, email: token.email, sessionVersion: token.sessionVersion },
      data: { emailVerifiedAt: token.user.emailVerifiedAt ?? now },
    });
    if (result.count !== 1) throw staleCredentials();
  });
}

async function revokeCredentials(tx: Prisma.TransactionClient, user: User, passwordHash: string, now: Date, verifyEmail: boolean) {
  const changed = await tx.user.updateMany({
    where: { id: user.id, sessionVersion: user.sessionVersion, passwordHash: user.passwordHash, email: user.email },
    data: { passwordHash, sessionVersion: { increment: 1 }, ...(verifyEmail ? { emailVerifiedAt: user.emailVerifiedAt ?? now } : {}) },
  });
  if (changed.count !== 1) throw staleCredentials();
  await tx.authToken.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } });
  await tx.session.deleteMany({ where: { userId: user.id } });
}

export async function resetAccountPassword(input: { token: string; password: string; passwordConfirmation: string }): Promise<void> {
  const tokenHash = hashAuthToken(parseAuthToken(input.token));
  const passwordHash = await hashPassword(validateNewAccountPassword(input.password, input.passwordConfirmation));
  await withSerializableTransaction(async (tx) => {
    const now = new Date();
    const token = await requireToken(tx, tokenHash, "password_reset", now);
    if (token.user.legacyAccount && !token.user.emailVerifiedAt) throw invalidToken();
    await consumeToken(tx, token.id, now);
    await revokeCredentials(tx, token.user, passwordHash, now, true);
  });
}

export async function changeAccountPassword(input: { userId: string; currentPassword: string; password: string; passwordConfirmation: string }): Promise<void> {
  const password = validateNewAccountPassword(input.password, input.passwordConfirmation);
  const proof = await proveCurrentPassword(input.userId, input.currentPassword);
  const passwordHash = await hashPassword(password);
  await withSerializableTransaction(async (tx) => {
    const user = await requireUnchangedUser(tx, proof);
    await revokeCredentials(tx, user, passwordHash, new Date(), false);
  });
}

export async function revokeOtherAccountSessions(input: { userId: string; sessionId: string; currentPassword: string }): Promise<void> {
  const proof = await proveCurrentPassword(input.userId, input.currentPassword);
  await withSerializableTransaction(async (tx) => {
    const user = await requireUnchangedUser(tx, proof);
    const now = new Date();
    const current = await tx.session.findFirst({
      where: { id: input.sessionId, userId: user.id, sessionVersion: user.sessionVersion, expiresAt: { gt: now } },
    });
    if (!current) throw new HttpError(401, "Сессия завершена. Войдите снова.");
    const changed = await tx.user.updateMany({
      where: { id: user.id, sessionVersion: user.sessionVersion, passwordHash: user.passwordHash },
      data: { sessionVersion: { increment: 1 } },
    });
    if (changed.count !== 1) throw staleCredentials();
    const kept = await tx.session.updateMany({
      where: { id: current.id, userId: user.id, sessionVersion: user.sessionVersion, expiresAt: { gt: now } },
      data: { sessionVersion: user.sessionVersion + 1 },
    });
    if (kept.count !== 1) throw staleCredentials();
    await tx.session.deleteMany({ where: { userId: user.id, id: { not: current.id } } });
    await tx.authToken.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } });
  });
}
