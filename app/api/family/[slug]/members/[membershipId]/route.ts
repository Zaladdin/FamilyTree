import { NextResponse } from "next/server";
import { requireFamilyRole } from "@/lib/auth";
import {
  parseAssignableRole,
  removeFamilyMember,
  updateFamilyMemberRole,
} from "@/lib/family-members";
import { HttpError } from "@/lib/http-error";
import { assertSameOrigin } from "@/lib/request-validation";
import { FAMILY_ROLE_LABELS } from "@/lib/types";

type RouteContext = {
  params: Promise<{ slug: string; membershipId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { slug, membershipId } = await context.params;

  try {
    assertSameOrigin(request);
    const access = await requireFamilyRole(slug, ["owner", "admin"]);
    const payload = (await request.json()) as Record<string, unknown>;
    const role = parseAssignableRole(payload?.role);

    const member = await updateFamilyMemberRole({
      slug,
      membershipId,
      role,
      actor: {
        userId: access.user.id,
        role: access.role,
        name: `${access.user.firstName} ${access.user.lastName}`,
      },
    });

    return NextResponse.json({
      message: `Роль участника ${member.name} — "${FAMILY_ROLE_LABELS[member.role]}".`,
      member,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось изменить роль участника.",
      },
      { status },
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { slug, membershipId } = await context.params;

  try {
    assertSameOrigin(request);
    // Any role may call this: leaving the family is a self-service action.
    // Removing someone else is authorized inside removeFamilyMember.
    const access = await requireFamilyRole(slug, [
      "owner",
      "admin",
      "editor",
      "member",
      "guest",
    ]);

    const result = await removeFamilyMember({
      slug,
      membershipId,
      actor: {
        userId: access.user.id,
        role: access.role,
        name: `${access.user.firstName} ${access.user.lastName}`,
      },
    });

    return NextResponse.json({
      message: result.isSelf
        ? "Вы покинули семейное пространство."
        : `${result.name} исключен(а) из семьи.`,
      leftFamily: result.isSelf,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось исключить участника.",
      },
      { status },
    );
  }
}
