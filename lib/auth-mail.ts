import { parseAuthToken } from "@/lib/auth-token";
import { HttpError } from "@/lib/http-error";

export type AuthMailInput = {
  to: string;
  kind: "verify_email" | "password_reset" | "family_invitation";
  token: string;
  familyTitle?: string;
};

export type AuthMailMessage = { to: string; subject: string; text: string };
export type AuthMailTransport = { send(message: AuthMailMessage): Promise<void> };

/** A fixed configured origin, never a request Host/Origin header. */
function trustedOrigin(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    if (url.protocol !== "https:" || url.username || url.password
      || url.pathname !== "/" || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    throw new Error("Укажите доверенный HTTPS-адрес приложения для писем.");
  }
}

/** Inject a local memory transport in tests; external delivery requires a separately configured adapter. */
export function createAuthMailSender(transport: AuthMailTransport | null, publicOrigin?: string) {
  const origin = transport ? trustedOrigin(publicOrigin) : null;
  return async (input: AuthMailInput): Promise<boolean> => {
    if (!transport || !origin) return false;
    if (input.to.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to)) {
      throw new HttpError(400, "Укажите корректный email.");
    }
    const token = parseAuthToken(input.token);
    const content = {
      verify_email: { path: "/verify-email", subject: "Подтверждение почты в Родово", explanation: "Войдите в свой аккаунт и подтвердите адрес почты." },
      password_reset: { path: "/reset-password", subject: "Восстановление доступа в Родово", explanation: "Установите новый пароль. После этого потребуется заново войти на всех устройствах." },
      family_invitation: { path: "/invitations/accept", subject: "Приглашение в семейный архив Родово", explanation: `Вас пригласили в семейный архив${input.familyTitle ? ` «${input.familyTitle}»` : ""}. Войдите с этим адресом, подтвердите почту и явно примите приглашение.` },
    }[input.kind];
    const url = new URL(content.path, origin);
    // Fragments never reach the server access log or HTTP Referer. The landing
    // form sends the secret only in a same-origin POST body after user action.
    url.hash = new URLSearchParams({ token }).toString();
    try {
      await transport.send({
        to: input.to,
        subject: content.subject,
        text: `${content.explanation}\n\n${url.href}\n\nЕсли вы не ожидали это письмо, проигнорируйте его. Не пересылайте ссылку другим людям.`,
      });
      return true;
    } catch {
      // Provider exceptions may contain addresses and complete action URLs.
      // Callers receive an explicit failure, without private provider details.
      return false;
    }
  };
}

// No provider, credentials or outbound email are enabled by this implementation.
// Integrate an approved transport here; synthetic tests inject their own sender.
export const sendAuthEmail = createAuthMailSender(null);
