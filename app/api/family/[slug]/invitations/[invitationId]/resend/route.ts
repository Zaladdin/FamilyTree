import { withObservedRoute } from "@/lib/observability";
import { NextResponse } from "next/server";
import { requireFamilyRole } from "@/lib/auth";
import { resendFamilyInvitation } from "@/lib/family-invitations";
import { familyWriteErrorResponse } from "@/lib/family-write-error";
import { assertSameOrigin } from "@/lib/request-validation";
import { enforceInvitationRateLimit } from "@/lib/family-invitation-rate-limit";

async function handlePOST(request: Request, context: { params: Promise<{ slug: string; invitationId: string }> }) {
  const { slug, invitationId } = await context.params;
  try {
    assertSameOrigin(request);
    const access = await requireFamilyRole(slug, ["owner", "admin"]);
    const payload = await request.json();
    await enforceInvitationRateLimit(request, access.user.id, `${slug}:${invitationId}`);
    const result = await resendFamilyInvitation({ slug, invitationId, expectedVersion: payload?.expectedVersion, actor: { userId: access.user.id, name: `${access.user.firstName} ${access.user.lastName}` } });
    return NextResponse.json({ ...result, message: result.delivery === "sent" ? "Новая ссылка отправлена. Предыдущая ссылка больше не действует." : "Новая ссылка подготовлена, но письмо не отправлено: доставка почты недоступна." });
  } catch (error) {
    const result = familyWriteErrorResponse(error, { fallback: "Не удалось отправить приглашение.", invalidJson: "Некорректные данные запроса." });
    return NextResponse.json(result.body, { status: result.status });
  }
}

export const POST = withObservedRoute("/api/family/[slug]/invitations/[invitationId]/resend", handlePOST);
