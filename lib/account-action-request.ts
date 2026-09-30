export class AccountActionError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); }
}

export type AccountActionResult = { message: string; delivered?: boolean; delivery?: "sent" | "unavailable"; slug?: string; leftFamily?: boolean };

export function readFragmentToken(fragment: string): string {
  if (!fragment.startsWith("#")) return "";
  const values = new URLSearchParams(fragment.slice(1)).getAll("token");
  const token = values.length === 1 ? values[0] : "";
  return token && token.length <= 1024 && /^[a-zA-Z0-9_-]+$/.test(token) ? token : "";
}

/** Never retry account mutations or echo transport/server details. */
export async function requestAccountAction(request: () => Promise<Response>, fallback: string): Promise<AccountActionResult> {
  let response: Response;
  try { response = await request(); } catch { throw new AccountActionError("Не удалось связаться с сервером. Проверьте соединение и результат операции перед повторной попыткой."); }
  if (response.status >= 500) throw new AccountActionError(`${fallback} Сервис временно недоступен. Попробуйте позже.`, response.status);
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new AccountActionError(fallback, response.status); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new AccountActionError(fallback, response.status);
  const body = payload as Record<string, unknown>;
  if (!response.ok) throw new AccountActionError(typeof body.error === "string" ? body.error : fallback, response.status);
  if (typeof body.message !== "string") throw new AccountActionError(fallback, response.status);
  return {
    message: body.message,
    ...(typeof body.delivered === "boolean" ? { delivered: body.delivered } : {}),
    ...(body.delivery === "sent" || body.delivery === "unavailable" ? { delivery: body.delivery } : {}),
    ...(typeof body.slug === "string" ? { slug: body.slug } : {}),
    ...(typeof body.leftFamily === "boolean" ? { leftFamily: body.leftFamily } : {}),
  };
}

export function postAccountAction(path: string, payload: unknown) {
  return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}
