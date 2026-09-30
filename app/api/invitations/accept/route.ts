import { withObservedRoute } from "@/lib/observability";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { acceptFamilyInvitation } from "@/lib/family-invitations";
import { familyWriteErrorResponse } from "@/lib/family-write-error";
import { assertSameOrigin } from "@/lib/request-validation";
import { enforceInvitationRateLimit } from "@/lib/family-invitation-rate-limit";

async function handlePOST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceInvitationRateLimit(request, user.id);
    const payload = await request.json();
    const result = await acceptFamilyInvitation({ token: payload?.token, userId: user.id });
    return NextResponse.json({ ...result, message: result.alreadyAccepted ? "Приглашение уже принято." : "Приглашение принято." });
  } catch (error) {
    const result = familyWriteErrorResponse(error, { fallback: "Не удалось принять приглашение.", invalidJson: "Некорректные данные запроса." });
    return NextResponse.json(result.body, { status: result.status });
  }
}

export const POST = withObservedRoute("/api/invitations/accept", handlePOST);
