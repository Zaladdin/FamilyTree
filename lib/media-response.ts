import { openUploadByStoragePath } from "@/lib/media-storage";

type MediaOriginal = { storagePath: string; mimeType: string; title: string; size?: number; checksum?: string | null };

function parseRange(value: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return null;
  if (first === null) return last && last > 0 ? { start: Math.max(0, size - last), end: size - 1 } : null;
  if (first >= size || (last !== null && last < first)) return null;
  return { start: first, end: Math.min(last ?? size - 1, size - 1) };
}

/** One byte range only; malformed and multipart ranges receive a deterministic 416. */
export async function buildMediaResponse(request: Request, asset: MediaOriginal) {
  const abortError = () => new DOMException("Передача медиафайла отменена.", "AbortError");
  if (request.signal.aborted) throw abortError();
  const { handle, size } = await openUploadByStoragePath(asset.storagePath);
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  function close() {
    closed = true;
    request.signal.removeEventListener("abort", onAbort);
    return closePromise ??= handle.close();
  }
  function onAbort() {
    streamController?.error(abortError());
    // Some transports stop before piping/cancelling the body. The signal must
    // release its descriptor independently, including an unread queued chunk.
    void close().catch(() => {
      process.emitWarning("Не удалось закрыть медиафайл после отмены запроса.", { code: "MEDIA_STREAM_CLOSE_FAILED" });
    });
  }
  try {
    if (request.signal.aborted) throw abortError();
    request.signal.addEventListener("abort", onAbort, { once: true });
    const headers = new Headers({
      "Content-Type": asset.mimeType, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.title.toWellFormed()).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    });
    const etag = asset.checksum && /^[a-f0-9]{64}$/.test(asset.checksum) ? `"${asset.checksum}"` : null;
    if (etag) headers.set("ETag", etag);
    // Next.js dispatches an implicit HEAD to GET but never consumes its body.
    // Close here rather than allocating an unread stream; Range only applies to GET.
    if (request.method === "HEAD") {
      headers.set("Content-Length", String(size));
      await close();
      return new Response(null, { status: 200, headers });
    }
    const ifRange = request.headers.get("if-range");
    // We publish a strong checksum validator, not a modification-date validator.
    // Unknown, weak or historical validators require the complete current original.
    const rangeHeader = ifRange !== null && (etag === null || ifRange !== etag) ? null : request.headers.get("range");
    const range = rangeHeader === null ? { start: 0, end: size - 1 } : parseRange(rangeHeader, size);
    if (!range) { await close(); headers.set("Content-Range", `bytes */${size}`); headers.set("Content-Length", "0"); return new Response(null, { status: 416, headers }); }
    let position = range.start;
    headers.set("Content-Length", String(range.end - range.start + 1));
    if (rangeHeader !== null) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { streamController = controller; },
      async pull(controller) {
        if (closed) return;
        try {
          const remaining = range!.end - position + 1;
          if (remaining <= 0) { await close(); controller.close(); return; }
          const buffer = new Uint8Array(Math.min(64 * 1024, remaining));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
          if (closed) return;
          if (bytesRead === 0) throw new Error("Медиафайл изменился во время чтения.");
          position += bytesRead; controller.enqueue(buffer.subarray(0, bytesRead));
          if (position > range!.end) { await close(); controller.close(); }
        } catch (error) { await close(); controller.error(error); }
      },
      cancel: close,
    });
    return new Response(stream, { status: rangeHeader === null ? 200 : 206, headers });
  } catch (error) { await close(); throw error; }
}
