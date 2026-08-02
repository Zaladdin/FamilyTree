import { assertValidEmail } from "@/lib/auth";
import { HttpError } from "@/lib/http-error";
import { prisma } from "@/lib/prisma";
import { FAMILY_ROLE_LABELS, FamilyMemberView, FamilyRole } from "@/lib/types";

// Owner is created together with the family and can never be assigned here.
const ASSIGNABLE_ROLES: FamilyRole[] = ["admin", "editor", "member", "guest"];

export function parseAssignableRole(value: unknown): FamilyRole {
  if (typeof value !== "string" || !ASSIGNABLE_ROLES.includes(value as FamilyRole)) {
    throw new HttpError(400, "Роль должна быть admin, editor, member или guest.");
  }

  return value as FamilyRole;
}

async function requireFamilyIdBySlug(slug: string) {
  const family = await prisma.family.findUnique({
    where: { slug },
    select: { id: true },
  });

  if (!family) {
    throw new HttpError(404, "Семья не найдена.");
  }

  return family.id;
}

async function requireMembership(familyId: string, membershipId: string) {
  const membership = await prisma.familyMembership.findFirst({
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
  actor: { userId: string; role: FamilyRole; name: string };
}) {
  const { slug, role, actor } = params;
  const email = assertValidEmail(params.email);

  assertCanAssignRole(actor.role, role);

  const familyId = await requireFamilyIdBySlug(slug);
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, firstName: true, lastName: true },
  });

  if (!user) {
    throw new HttpError(
      404,
      "Пользователь с таким email не зарегистрирован. Попросите родственника сначала создать аккаунт.",
    );
  }

  const existing = await prisma.familyMembership.findFirst({
    where: { familyId, userId: user.id },
    select: { id: true },
  });

  if (existing) {
    throw new HttpError(409, "Этот пользователь уже состоит в семье.");
  }

  const memberName = `${user.firstName} ${user.lastName}`;

  const membership = await prisma.$transaction(async (transaction) => {
    const created = await transaction.familyMembership.create({
      data: {
        familyId,
        userId: user.id,
        name: memberName,
        role,
      },
    });

    await transaction.family.update({
      where: { id: familyId },
      data: { contributorsCount: { increment: 1 } },
    });

    await transaction.auditLog.create({
      data: {
        familyId,
        action: "member_added",
        actorName: actor.name,
        message: `${actor.name} добавил(а) участника "${memberName}" с ролью "${FAMILY_ROLE_LABELS[role]}".`,
      },
    });

    return created;
  });

  return { membershipId: membership.id, name: memberName, role };
}

export async function updateFamilyMemberRole(params: {
  slug: string;
  membershipId: string;
  role: FamilyRole;
  actor: { userId: string; role: FamilyRole; name: string };
}) {
  const { slug, membershipId, role, actor } = params;
  const familyId = await requireFamilyIdBySlug(slug);
  const membership = await requireMembership(familyId, membershipId);

  assertCanManageTarget(actor.role, membership.role);
  assertCanAssignRole(actor.role, role);

  if (membership.userId === actor.userId) {
    throw new HttpError(403, "Нельзя менять собственную роль.");
  }

  if (membership.role === role) {
    return { membershipId, name: membership.name, role };
  }

  await prisma.$transaction(async (transaction) => {
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
  });

  return { membershipId, name: membership.name, role };
}

export async function removeFamilyMember(params: {
  slug: string;
  membershipId: string;
  actor: { userId: string; role: FamilyRole; name: string };
}) {
  const { slug, membershipId, actor } = params;
  const familyId = await requireFamilyIdBySlug(slug);
  const membership = await requireMembership(familyId, membershipId);
  const isSelf = membership.userId === actor.userId;

  // Any non-owner may leave the family; removing someone else follows the
  // regular management rules.
  if (isSelf) {
    if (membership.role === "owner") {
      throw new HttpError(403, "Владелец не может покинуть собственную семью.");
    }
  } else {
    assertCanManageTarget(actor.role, membership.role);
  }

  await prisma.$transaction(async (transaction) => {
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
  });

  return { membershipId, name: membership.name, isSelf };
}
