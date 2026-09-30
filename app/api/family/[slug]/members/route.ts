import { withObservedRoute } from "@/lib/observability";
import { NextResponse } from "next/server";
import { familyWriteErrorResponse } from "@/lib/family-write-error";
import { requireFamilyRole } from "@/lib/auth";
import {
  addFamilyMemberByEmail,
  listFamilyMembers,
  parseAssignableRole,
} from "@/lib/family-members";
import { HttpError } from "@/lib/http-error";
import { assertSameOrigin } from "@/lib/request-validation";
import { enforceInvitationRateLimit } from "@/lib/family-invitation-rate-limit";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

async function handleGET(_request: Request, context: RouteContext) {
  const { slug } = await context.params;

  try {
    const access = await requireFamilyRole(slug, [
      "owner",
      "admin",
      "editor",
      "member",
      "guest",
    ]);
    const members = await listFamilyMembers(slug, access.user.id);

    return NextResponse.json({ members, viewerRole: access.role });
  } catch (error) {
    const response = familyWriteErrorResponse(error, {
      fallback: "Не удалось загрузить список участников.",
      invalidJson: "Некорректные данные запроса.",
    });
    return NextResponse.json(response.body, { status: response.status });
  }
}

async function handlePOST(request: Request, context: RouteContext) {
  const { slug } = await context.params;

  try {
    assertSameOrigin(request);
    const access = await requireFamilyRole(slug, ["owner", "admin"]);
    const payload = (await request.json()) as Record<string, unknown>;

    if (typeof payload?.email !== "string") {
      throw new HttpError(400, "Укажите email участника.");
    }

    const role = parseAssignableRole(payload.role);
    await enforceInvitationRateLimit(request, access.user.id, `${slug}:${payload.email.trim().toLowerCase()}`);
    const result = await addFamilyMemberByEmail({
      slug,
      email: payload.email,
      role,
      actor: {
        userId: access.user.id,
        name: `${access.user.firstName} ${access.user.lastName}`,
      },
    });

    return NextResponse.json({
      message: result.delivery === "sent"
        ? "Приглашение отправлено. Доступ появится после подтверждения email и принятия приглашения."
        : "Приглашение сохранено, но письмо не отправлено: доставка почты пока недоступна. Доступ к семье не выдан.",
      ...result,
    });
  } catch (error) {
    const response = familyWriteErrorResponse(error, {
      fallback: "Не удалось добавить участника.",
      invalidJson: "Некорректные данные запроса.",
    });
    return NextResponse.json(response.body, { status: response.status });
  }
}

export const GET = withObservedRoute("/api/family/[slug]/members", handleGET);
export const POST = withObservedRoute("/api/family/[slug]/members", handlePOST);
