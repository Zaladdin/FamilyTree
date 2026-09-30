import { HttpError } from "@/lib/http-error";

export const MAX_MEDIA_REQUEST_BYTES = 21 * 1024 * 1024;

/** Count the actual stream before handing its bounded contents to the multipart parser. */
export async function readMediaFormData(request: Request): Promise<{ type: "photo" | "audio"; file: File }> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MEDIA_REQUEST_BYTES) {
    await request.body?.cancel();
    throw new HttpError(413, "Файл слишком большой.");
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !request.body) throw new HttpError(400, "Некорректные данные загрузки.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_MEDIA_REQUEST_BYTES) {
        await reader.cancel(); throw new HttpError(413, "Файл слишком большой.");
      }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  let form: FormData;
  try {
    const bounded = new Blob(chunks as BlobPart[]);
    form = await new Response(bounded, { headers: { "content-type": contentType } }).formData();
  } catch { throw new HttpError(400, "Некорректные данные загрузки."); }
  const fields = Array.from(form.keys());
  if (fields.length !== 2 || form.getAll("type").length !== 1 || form.getAll("file").length !== 1) {
    throw new HttpError(400, "Передайте один тип и один файл.");
  }
  const type = form.get("type"); const file = form.get("file");
  if (type !== "photo" && type !== "audio") throw new HttpError(400, "Нужно указать тип файла: photo или audio.");
  if (!(file instanceof File)) throw new HttpError(400, "Файл не был передан.");
  return { type, file };
}
