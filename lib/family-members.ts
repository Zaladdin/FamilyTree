import type { Prisma } from "@prisma/client";
import { HttpError } from "@/lib/http-error";
import { prisma } from "@/lib/prisma";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { FAMILY_ROLE_LABELS, FamilyMemberView, FamilyRole } from "@/lib/types";

// Owner is created together with the family and can never be assigned here.
const ASSIGNABLE_ROLES: FamilyRole[] = ["admin", "editor", "member", "guest"];

export function parseAssignableRole(value: unknown): FamilyRole {
  if (typeof value !== "string" || !ASSIGNABLE_ROLES.includes(value as FamilyRole)) {
    throw new HttpError(400, "Роль должна быть admin, editor, member или guest.");
  }

  return value as FamilyRole;
}

async function requireFamilyIdBySlug(slug: string, transaction: Prisma.TransactionClient = prisma) {
  const family = await transaction.family.findUnique({
    where: { slug },
    select: { id: true },
  });

  if (!family) {
    throw new HttpError(404, "Семья не найдена.");
  }

  return family.id;
}

async function requireMembership(transaction: Prisma.TransactionClient, familyId: string, membershipId: string) {
  const membership = await transaction.familyMembership.findFirst({
    where: { id: membershipId, familyId },
    select: {
      id: true,
      name: true,
      role: true,
      userId: true,
    },
  });

  if (!membership) {
    throw new HttpError(404, "Участник не найден.");
  }

  return membership;
}

async function requireActorRole(transaction: Prisma.TransactionClient, familyId: string, userId: string) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new HttpError(403, "Нет доступа к этой семье.");
  }

  const membership = await transaction.familyMembership.findFirst({
    where: { familyId, userId },
    select: { role: true },
  });

  if (!membership) {
    throw new HttpError(403, "Нет доступа к этой семье.");
  }

  return membership.role;
}

function assertIsManager(actorRole: FamilyRole) {
  if (actorRole !== "owner" && actorRole !== "admin") {
    throw new HttpError(403, "Управлять участниками могут только владелец и администраторы.");
  }
}

// Admins manage regular members, but only the owner touches other admins:
// otherwise any admin could demote peers or crown new admins unnoticed.
function assertCanManageTarget(actorRole: FamilyRole, targetRole: FamilyRole) {
  assertIsManager(actorRole);

  if (targetRole === "owner") {
    throw new HttpError(403, "Владельца семьи нельзя изменить или исключить.");
  }

  if (actorRole !== "owner" && targetRole === "admin") {
    throw new HttpError(403, "Менять администраторов может только владелец семьи.");
  }
}

function assertCanAssignRole(actorRole: FamilyRole, role: FamilyRole) {
  assertIsManager(actorRole);

  if (actorRole !== "owner" && role === "admin") {
    throw new HttpError(403, "Назначать администраторов может только владелец семьи.");
  }
}

export async function listFamilyMembers(
  slug: string,
  viewerUserId: string,
): Promise<FamilyMemberView[]> {
  const familyId = await requireFamilyIdBySlug(slug);
  const memberships = await prisma.familyMembership.findMany({
    where: { familyId },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      role: true,
      userId: true,
      createdAt: true,
      user: {
        select: { email: true },
      },
    },
  });

  return memberships.map((membership) => ({
    membershipId: membership.id,
    name: membership.name,
    email: membership.user?.email ?? null,
    role: membership.role,
    isViewer: membership.userId === viewerUserId,
    createdAt: membership.createdAt.toISOString(),
  }));
}

export async function getFamilyMembersPageData(slug: string, viewerUserId: string) {
  const family = await prisma.family.findUnique({
    where: { slug },
    select: { title: true },
  });

  if (!family) {
    return null;
  }

  const members = await listFamilyMembers(slug, viewerUserId);

  return { familyTitle: family.title, members };
}

export async function addFamilyMemberByEmail(params: {
  slug: string;
  email: string;
  role: FamilyRole;
  actor: { userId: string; name: string };
}) {
  // Compatibility entry point: an email never grants membership before verified acceptance.
  const { createFamilyInvitation } = await import("@/lib/family-invitations");
  return createFamilyInvitation(params);
}

export async function updateFamilyMemberRole(params: {
  slug: string;
  membershipId: string;
  role: FamilyRole;
  actor: { userId: string; name: string };
}) {
  const { slug, membershipId, actor } = params;
  const role = parseAssignableRole(params.role);
  return withSerializableTransaction(async (transaction) => {
    const familyId = await requireFamilyIdBySlug(slug, transaction);
    const actorRole = await requireActorRole(transaction, familyId, actor.userId);
    const membership = await requireMembership(transaction, familyId, membershipId);

    assertCanManageTarget(actorRole, membership.role);
    assertCanAssignRole(actorRole, role);

    if (membership.userId === actor.userId) {
      throw new HttpError(403, "Нельзя менять собственную роль.");
    }

    if (membership.role === role) {
      return { membershipId, name: membership.name, role };
    }

    await transaction.familyMembership.update({
      where: { id: membershipId },
      data: { role },
    });

    await transaction.auditLog.create({
      data: {
        familyId,
        action: "member_role_changed",
        actorName: actor.name,
        message: `${actor.name} изменил(а) роль участника "${membership.name}" на "${FAMILY_ROLE_LABELS[role]}".`,
      },
    });
    return { membershipId, name: membership.name, role };
  });
}

export async function removeFamilyMember(params: {
  slug: string;
  membershipId: string;
  actor: { userId: string; name: string };
}) {
  const { slug, membershipId, actor } = params;
  return withSerializableTransaction(async (transaction) => {
    const familyId = await requireFamilyIdBySlug(slug, transaction);
    const actorRole = await requireActorRole(transaction, familyId, actor.userId);
    const membership = await requireMembership(transaction, familyId, membershipId);
    const isSelf = membership.userId === actor.userId;

    // Any non-owner may leave; all other removals require current manager rights.
    if (isSelf) {
      if (membership.role === "owner") {
        throw new HttpError(403, "Владелец не может покинуть собственную семью.");
      }
    } else {
      assertCanManageTarget(actorRole, membership.role);
    }

    await transaction.familyMembership.delete({
      where: { id: membershipId },
    });

    await transaction.family.update({
      where: { id: familyId },
      data: { contributorsCount: { decrement: 1 } },
    });

    await transaction.auditLog.create({
      data: {
        familyId,
        action: "member_removed",
        actorName: actor.name,
        message: isSelf
          ? `${membership.name} покинул(а) семейное пространство.`
          : `${actor.name} исключил(а) участника "${membership.name}" из семьи.`,
      },
    });
    return { membershipId, name: membership.name, isSelf };
  });
}
