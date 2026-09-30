import { withObservedRoute } from "@/lib/observability";
import { setTimeout as delay } from "node:timers/promises";
import { assertValidEmail } from "@/lib/auth";
import { requestPasswordReset } from "@/lib/auth-account";
import { accountError, accountJson, accountPayload, accountRateLimit, accountString } from "@/lib/auth-account-route";
import { assertSameOrigin } from "@/lib/request-validation";

async function handlePOST(request: Request) {
  try {
    assertSameOrigin(request);
    const payload = await accountPayload(request);
    const email = assertValidEmail(accountString(payload, "email", 254));
    await accountRateLimit(request, "forgot", email);
    const startedAt = Date.now();
    try {
      await requestPasswordReset(email);
    } catch {
      // Storage conflicts, ineligible accounts and delivery failures must not
      // reveal whether the address belongs to a recoverable account.
    }
    // Covers the current local adapter/DB path; an external provider must be
    // re-evaluated for latency when delivery is configured.
    await delay(Math.max(0, 350 - (Date.now() - startedAt)));
    return accountJson({ message: "Если для этого адреса доступно восстановление, письмо со ссылкой будет отправлено. Проверьте почту или попробуйте позже." }, 202);
  } catch (error) { return accountError(error); }
}

export const POST = withObservedRoute("/api/auth/forgot-password", handlePOST);
