import { withObservedRoute } from "@/lib/observability";
import { clearSessionCookie } from "@/lib/auth";
import { resetAccountPassword } from "@/lib/auth-account";
import { accountError, accountJson, accountPayload, accountRateLimit, accountString } from "@/lib/auth-account-route";
import { parseAuthToken } from "@/lib/auth-token";
import { assertSameOrigin } from "@/lib/request-validation";

async function handlePOST(request: Request) {
  try {
    assertSameOrigin(request);
    const payload = await accountPayload(request);
    const token = parseAuthToken(payload.token);
    await accountRateLimit(request, "reset", token, 10);
    await resetAccountPassword({ token, password: accountString(payload, "password"), passwordConfirmation: accountString(payload, "passwordConfirmation") });
    await clearSessionCookie();
    return accountJson({ message: "Пароль изменён. Войдите заново с новым паролем." });
  } catch (error) { return accountError(error); }
}

export const POST = withObservedRoute("/api/auth/reset-password", handlePOST);
