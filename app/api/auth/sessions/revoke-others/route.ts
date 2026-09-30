import { withObservedRoute } from "@/lib/observability";
import { getCurrentSession } from "@/lib/auth";
import { revokeOtherAccountSessions } from "@/lib/auth-account";
import { accountError, accountJson, accountPayload, accountRateLimit, accountString } from "@/lib/auth-account-route";
import { HttpError } from "@/lib/http-error";
import { assertSameOrigin } from "@/lib/request-validation";

async function handlePOST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getCurrentSession();
    if (!session) throw new HttpError(401, "Нужно войти в аккаунт.");
    await accountRateLimit(request, "revoke", session.user.id);
    const payload = await accountPayload(request);
    await revokeOtherAccountSessions({ userId: session.user.id, sessionId: session.id, currentPassword: accountString(payload, "currentPassword") });
    return accountJson({ message: "Другие сессии завершены. На этом устройстве вход сохранён." });
  } catch (error) { return accountError(error); }
}

export const POST = withObservedRoute("/api/auth/sessions/revoke-others", handlePOST);
