import { withObservedRoute } from "@/lib/observability";
import { requireUser } from "@/lib/auth";
import { confirmEmailVerification } from "@/lib/auth-account";
import { accountError, accountJson, accountPayload, accountRateLimit } from "@/lib/auth-account-route";
import { parseAuthToken } from "@/lib/auth-token";
import { assertSameOrigin } from "@/lib/request-validation";

async function handlePOST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await accountRateLimit(request, "verify-confirm", user.id, 10);
    const payload = await accountPayload(request);
    await confirmEmailVerification({ userId: user.id, token: parseAuthToken(payload.token) });
    return accountJson({ message: "Адрес электронной почты подтверждён." });
  } catch (error) { return accountError(error); }
}

export const POST = withObservedRoute("/api/auth/verify-email/confirm", handlePOST);
