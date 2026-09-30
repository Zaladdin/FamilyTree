import { withObservedRoute } from "@/lib/observability";
import { NextResponse } from "next/server";
import { requireFamilyRole } from "@/lib/auth";
import { revokeFamilyInvitation, updateFamilyInvitation } from "@/lib/family-invitations";
import { parseAssignableRole } from "@/lib/family-members";
import { familyWriteErrorResponse } from "@/lib/family-write-error";
import { assertSameOrigin } from "@/lib/request-validation";
import { enforceInvitationRateLimit } from "@/lib/family-invitation-rate-limit";

type Context = { params: Promise<{ slug: string; invitationId: string }> };
async function mutate(request: Request, context: Context, revoke: boolean) {
  const { slug, invitationId } = await context.params;
  try {
    assertSameOrigin(request);
    const access = await requireFamilyRole(slug, ["owner", "admin"]);
    const payload = await request.json();
    const params = { slug, invitationId, expectedVersion: payload?.expectedVersion, actor: { userId: access.user.id, name: `${access.user.firstName} ${access.user.lastName}` } };
    if (revoke) return NextResponse.json({ ...await revokeFamilyInvitation(params), message: "Приглашение отозвано." });
    await enforceInvitationRateLimit(request, access.user.id, `${slug}:${invitationId}`);
    const result = await updateFamilyInvitation({ ...params, role: parseAssignableRole(payload?.role) });
    return NextResponse.json({ ...result, message: result.delivery === "sent" ? "Роль обновлена, новая ссылка отправлена." : "Роль обновлена, но новая ссылка не отправлена: доставка почты недоступна." });
  } catch (error) {
    const result = familyWriteErrorResponse(error, { fallback: "Не удалось изменить приглашение.", invalidJson: "Некорректные данные запроса." });
    return NextResponse.json(result.body, { status: result.status });
  }
}
const handlePATCH = (request: Request, context: Context) => mutate(request, context, false);
const handleDELETE = (request: Request, context: Context) => mutate(request, context, true);

export const PATCH = withObservedRoute("/api/family/[slug]/invitations/[invitationId]", handlePATCH);
export const DELETE = withObservedRoute("/api/family/[slug]/invitations/[invitationId]", handleDELETE);
