import { withObservedRoute } from "@/lib/observability";
import { requireUser } from "@/lib/auth";
import { requestEmailVerification } from "@/lib/auth-account";
import { accountError, accountJson, accountPayload, accountRateLimit, accountString } from "@/lib/auth-account-route";
import { assertSameOrigin } from "@/lib/request-validation";

async function handlePOST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await accountRateLimit(request, "verify-request", user.id);
    const payload = await accountPayload(request);
    const { delivered } = await requestEmailVerification({ userId: user.id, currentPassword: accountString(payload, "currentPassword") });
    return accountJson({ delivered, message: delivered ? "Письмо для подтверждения отправлено." : "Отправка писем пока недоступна. Попробуйте позже." }, 202);
  } catch (error) { return accountError(error); }
}

export const POST = withObservedRoute("/api/auth/verify-email/request", handlePOST);
