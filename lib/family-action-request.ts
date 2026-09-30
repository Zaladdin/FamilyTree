export type FamilyActionResponse = { error?: string; message?: string; personId?: string; storyId?: string; version?: number; warnings?: string[] };

/** Mutations are never retried automatically: a lost response may follow a successful write. */
export async function requestFamilyAction(request: () => Promise<Response>, fallback: string): Promise<FamilyActionResponse> {
  let response: Response;
  try {
    response = await request();
  } catch {
    throw new Error("Не удалось связаться с сервером. Данные остались в форме. Проверьте соединение и результат операции перед повторной отправкой.");
  }
  if (response.status >= 500) {
    if (response.status === 503) {
      let unavailable: unknown;
      try { unavailable = await response.json(); } catch { unavailable = null; }
      // Only a known code selects our own copy; never display a server's 5xx text.
      if (unavailable && typeof unavailable === "object" && !Array.isArray(unavailable) &&
        (unavailable as Record<string, unknown>).code === "SIBLING_SCHEMA_NOT_READY") {
        throw new Error("Для связи «брат / сестра» требуется обновление базы данных. Заполненные данные остались в форме. Обратитесь к администратору.");
      }
    }
    throw new Error(`${fallback} Сервер временно недоступен. Попробуйте позже.`);
  }
  let data: unknown;
  try { data = await response.json(); } catch { throw new Error(fallback); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(fallback);
  const body = data as Record<string, unknown>;
  const result: FamilyActionResponse = {
    ...(typeof body.error === "string" ? { error: body.error } : {}),
    ...(typeof body.message === "string" ? { message: body.message } : {}),
    ...(typeof body.personId === "string" ? { personId: body.personId } : {}),
    ...(typeof body.storyId === "string" ? { storyId: body.storyId } : {}),
    ...(typeof body.version === "number" && Number.isSafeInteger(body.version) && body.version >= 0 ? { version: body.version } : {}),
    ...(Array.isArray(body.warnings) && body.warnings.every((warning) => typeof warning === "string") ? { warnings: body.warnings as string[] } : {}),
  };
  if (!response.ok) throw new Error(result.error || fallback);
  return result;
}
