import type { FamilyInvitation, Prisma } from "@prisma/client";
import { assertValidEmail } from "@/lib/auth";
import { sendAuthEmail } from "@/lib/auth-mail";
import { authTokenExpiry, generateAuthToken, hashAuthToken, parseAuthToken } from "@/lib/auth-token";
import { parseAssignableRole } from "@/lib/family-members";
import { HttpError } from "@/lib/http-error";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import type { FamilyRole } from "@/lib/types";

export type InvitationView = {
  id: string;
  email: string;
  role: FamilyRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
  version: number;
};
type Actor = { userId: string; name: string };
type Mutation = { slug: string; invitationId: string; expectedVersion: number; actor: Actor };
const conflict = () => new HttpError(409, "Приглашение уже изменено. Обновите список и повторите действие.");

function view(row: FamilyInvitation): InvitationView {
  return {
    id: row.id, email: row.email, role: row.role,
    status: row.status === "pending" && row.expiresAt <= new Date() ? "expired" : row.status,
    expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(), version: row.version,
  };
}
async function familyBySlug(tx: Prisma.TransactionClient, slug: string) {
  const family = await tx.family.findUnique({ where: { slug }, select: { id: true, title: true, slug: true } });
  if (!family) throw new HttpError(404, "Семья не найдена.");
  return family;
}
async function managerRole(tx: Prisma.TransactionClient, familyId: string, userId: string) {
  if (typeof userId !== "string" || !userId.trim()) throw new HttpError(403, "Нет доступа к управлению приглашениями.");
  const membership = await tx.familyMembership.findFirst({ where: { familyId, userId }, select: { role: true } });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    throw new HttpError(403, "Управлять приглашениями могут только владелец и администраторы.");
  }
  return membership.role;
}
function canAssign(manager: FamilyRole, role: FamilyRole) {
  if (role === "owner" || (role === "admin" && manager !== "owner")) {
    throw new HttpError(403, "Назначать администраторов может только владелец семьи.");
  }
}
function version(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new HttpError(400, "Укажите версию приглашения.");
  return value as number;
}
async function currentInvitation(tx: Prisma.TransactionClient, params: Mutation) {
  const expectedVersion = version(params.expectedVersion);
  const family = await familyBySlug(tx, params.slug);
  const manager = await managerRole(tx, family.id, params.actor.userId);
  const invitation = await tx.familyInvitation.findFirst({ where: { id: params.invitationId, familyId: family.id } });
  if (!invitation) throw new HttpError(404, "Приглашение не найдено.");
  canAssign(manager, invitation.role);
  if (invitation.version !== expectedVersion) throw conflict();
  return { family, manager, invitation };
}
async function change(tx: Prisma.TransactionClient, invitation: FamilyInvitation, data: Prisma.FamilyInvitationUncheckedUpdateManyInput) {
  const updated = await tx.familyInvitation.updateMany({
    where: { id: invitation.id, familyId: invitation.familyId, version: invitation.version },
    data: { ...data, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw conflict();
  const row = await tx.familyInvitation.findUnique({ where: { id: invitation.id } });
  if (!row) throw conflict();
  return row;
}
async function audit(tx: Prisma.TransactionClient, familyId: string, actor: Actor, action: "invitation_created" | "invitation_updated" | "invitation_revoked") {
  await tx.auditLog.create({ data: { familyId, actorName: actor.name, action, message: action === "invitation_revoked" ? `${actor.name} отозвал(а) приглашение в семью.` : `${actor.name} сохранил(а) приглашение в семью.` } });
}
async function deliver(row: FamilyInvitation, token: string, familyTitle: string, send: typeof sendAuthEmail) {
  // Delivery happens only after the transaction commits; retries never send extra letters.
  const sent = await send({ to: row.email, kind: "family_invitation", token, familyTitle });
  return { invitation: view(row), delivery: sent ? "sent" as const : "unavailable" as const };
}

export async function getFamilyInvitations(slug: string, actorUserId: string): Promise<InvitationView[]> {
  return withSerializableTransaction(async (tx) => {
    const family = await familyBySlug(tx, slug);
    await managerRole(tx, family.id, actorUserId);
    const rows = await tx.familyInvitation.findMany({ where: { familyId: family.id }, orderBy: { createdAt: "desc" } });
    return rows.map(view);
  });
}

export async function createFamilyInvitation(params: { slug: string; email: string; role: FamilyRole; actor: Actor }, send = sendAuthEmail) {
  const email = assertValidEmail(params.email);
  const role = parseAssignableRole(params.role);
  const token = generateAuthToken();
  const result = await withSerializableTransaction(async (tx) => {
    const family = await familyBySlug(tx, params.slug);
    canAssign(await managerRole(tx, family.id, params.actor.userId), role);
    const user = await tx.user.findUnique({ where: { email }, select: { id: true } });
    if (user && await tx.familyMembership.findFirst({ where: { familyId: family.id, userId: user.id }, select: { id: true } })) {
      throw new HttpError(409, "Этот пользователь уже состоит в семье.");
    }
    const existing = await tx.familyInvitation.findUnique({ where: { familyId_email: { familyId: family.id, email } } });
    if (existing && existing.status !== "accepted") throw new HttpError(409, "Приглашение для этого адреса уже существует. Используйте повторную отправку.");
    // A member who left can receive a new invitation, but an old accepted token cannot re-add them.
    const data = { role, invitedById: params.actor.userId, tokenHash: token.tokenHash, expiresAt: authTokenExpiry("invitation"), status: "pending" as const, acceptedAt: null, acceptedById: null };
    const invitation = existing
      ? await change(tx, existing, data)
      : await tx.familyInvitation.create({ data: { familyId: family.id, email, ...data } });
    await audit(tx, family.id, params.actor, "invitation_created");
    return { invitation, title: family.title };
  }, { retryUnique: true });
  return deliver(result.invitation, token.token, result.title, send);
}

export async function updateFamilyInvitation(params: Mutation & { role: FamilyRole }, send = sendAuthEmail) {
  const role = parseAssignableRole(params.role);
  const token = generateAuthToken();
  const result = await withSerializableTransaction(async (tx) => {
    const { family, manager, invitation } = await currentInvitation(tx, params);
    canAssign(manager, role);
    if (invitation.status !== "pending" || invitation.expiresAt <= new Date()) throw new HttpError(409, "Изменять роль можно только у действующего приглашения.");
    const updated = await change(tx, invitation, { role, invitedById: params.actor.userId, tokenHash: token.tokenHash });
    await audit(tx, family.id, params.actor, "invitation_updated");
    return { invitation: updated, title: family.title };
  });
  return deliver(result.invitation, token.token, result.title, send);
}

export async function revokeFamilyInvitation(params: Mutation) {
  return withSerializableTransaction(async (tx) => {
    const { family, invitation } = await currentInvitation(tx, params);
    if (invitation.status === "accepted" || invitation.status === "revoked") throw new HttpError(409, "Приглашение уже принято или отозвано.");
    const updated = await change(tx, invitation, { status: "revoked" });
    await audit(tx, family.id, params.actor, "invitation_revoked");
    return { invitation: view(updated) };
  });
}

export async function resendFamilyInvitation(params: Mutation, send = sendAuthEmail) {
  const token = generateAuthToken();
  const result = await withSerializableTransaction(async (tx) => {
    const { family, invitation } = await currentInvitation(tx, params);
    if (invitation.status === "accepted") throw new HttpError(409, "Приглашение уже принято.");
    const updated = await change(tx, invitation, { status: "pending", invitedById: params.actor.userId, tokenHash: token.tokenHash, expiresAt: authTokenExpiry("invitation") });
    await audit(tx, family.id, params.actor, "invitation_updated");
    return { invitation: updated, title: family.title };
  });
  return deliver(result.invitation, token.token, result.title, send);
}

export async function acceptFamilyInvitation(params: { token: unknown; userId: string }) {
  const tokenHash = hashAuthToken(parseAuthToken(params.token));
  if (typeof params.userId !== "string" || !params.userId.trim()) throw new HttpError(401, "Войдите в аккаунт, чтобы принять приглашение.");
  return withSerializableTransaction(async (tx) => {
    const invitation = await tx.familyInvitation.findUnique({ where: { tokenHash } });
    if (!invitation) throw new HttpError(400, "Приглашение недействительно. Попросите отправить новую ссылку.");
    const user = await tx.user.findUnique({ where: { id: params.userId }, select: { id: true, email: true, emailVerifiedAt: true, firstName: true, lastName: true } });
    if (!user || !user.emailVerifiedAt || assertValidEmail(user.email) !== invitation.email) {
      throw new HttpError(403, "Подтвердите email приглашённого адреса и войдите именно в этот аккаунт.");
    }
    const family = await tx.family.findUnique({ where: { id: invitation.familyId }, select: { slug: true } });
    if (!family) throw new HttpError(404, "Семья не найдена.");
    const existing = await tx.familyMembership.findFirst({ where: { familyId: invitation.familyId, userId: user.id }, select: { id: true } });
    if (invitation.status === "accepted") {
      if (invitation.acceptedById !== user.id || !existing) throw new HttpError(409, "Приглашение уже использовано. Для нового доступа нужно новое приглашение.");
      return { slug: family.slug, membershipId: existing.id, alreadyAccepted: true };
    }
    const now = new Date();
    if (invitation.status !== "pending" || invitation.expiresAt <= now) throw new HttpError(410, "Приглашение отозвано или срок действия истёк.");
    const inviterRole = await managerRole(tx, invitation.familyId, invitation.invitedById);
    canAssign(inviterRole, invitation.role);
    const accepted = await tx.familyInvitation.updateMany({
      where: { id: invitation.id, version: invitation.version, status: "pending", expiresAt: { gt: now } },
      data: { status: "accepted", acceptedById: user.id, acceptedAt: now, version: { increment: 1 } },
    });
    if (accepted.count !== 1) throw conflict();
    if (existing) return { slug: family.slug, membershipId: existing.id, alreadyAccepted: false };
    const name = `${user.firstName} ${user.lastName}`;
    const membership = await tx.familyMembership.create({ data: { familyId: invitation.familyId, userId: user.id, name, role: invitation.role } });
    await tx.family.update({ where: { id: invitation.familyId }, data: { contributorsCount: { increment: 1 } } });
    await tx.auditLog.create({ data: { familyId: invitation.familyId, action: "member_added", actorName: name, message: `${name} принял(а) приглашение в семью.` } });
    return { slug: family.slug, membershipId: membership.id, alreadyAccepted: false };
  }, { retryUnique: true });
}
