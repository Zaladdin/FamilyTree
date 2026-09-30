import { withObservedRoute } from "@/lib/observability";
import { NextResponse } from "next/server";
import { familyWriteErrorResponse } from "@/lib/family-write-error";
import { requireFamilyRole } from "@/lib/auth";
import {
  parseAssignableRole,
  removeFamilyMember,
  updateFamilyMemberRole,
} from "@/lib/family-members";
import { assertSameOrigin } from "@/lib/request-validation";
import { FAMILY_ROLE_LABELS } from "@/lib/types";

type RouteContext = {
  params: Promise<{ slug: string; membershipId: string }>;
};

async function handlePATCH(request: Request, context: RouteContext) {
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
        name: `${access.user.firstName} ${access.user.lastName}`,
      },
    });

    return NextResponse.json({
      message: `Роль участника ${member.name} — "${FAMILY_ROLE_LABELS[member.role]}".`,
      member,
    });
  } catch (error) {
    const response = familyWriteErrorResponse(error, {
      fallback: "Не удалось изменить роль участника.",
      invalidJson: "Некорректные данные запроса.",
    });
    return NextResponse.json(response.body, { status: response.status });
  }
}

async function handleDELETE(request: Request, context: RouteContext) {
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
    const response = familyWriteErrorResponse(error, {
      fallback: "Не удалось исключить участника.",
      invalidJson: "Некорректные данные запроса.",
    });
    return NextResponse.json(response.body, { status: response.status });
  }
}

export const PATCH = withObservedRoute("/api/family/[slug]/members/[membershipId]", handlePATCH);
export const DELETE = withObservedRoute("/api/family/[slug]/members/[membershipId]", handleDELETE);
