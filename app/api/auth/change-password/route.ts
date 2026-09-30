import { withObservedRoute } from "@/lib/observability";
import { clearSessionCookie, requireUser } from "@/lib/auth";
import { changeAccountPassword } from "@/lib/auth-account";
import { accountError, accountJson, accountPayload, accountRateLimit, accountString } from "@/lib/auth-account-route";
import { assertSameOrigin } from "@/lib/request-validation";

async function handlePOST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await accountRateLimit(request, "change", user.id, 10);
    const payload = await accountPayload(request);
    await changeAccountPassword({ userId: user.id, currentPassword: accountString(payload, "currentPassword"), password: accountString(payload, "password"), passwordConfirmation: accountString(payload, "passwordConfirmation") });
    await clearSessionCookie();
    return accountJson({ message: "Пароль изменён. Войдите заново с новым паролем." });
  } catch (error) { return accountError(error); }
}

export const POST = withObservedRoute("/api/auth/change-password", handlePOST);
