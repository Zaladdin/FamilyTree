import type { TreeExportStyle } from "@/lib/family-tree-export";

export type TreeExportFormat = "png" | "pdf";
export type TreeExportArtwork = { svg: string; width: number; height: number };

/** Bound both memory and individual canvas sides, including very wide trees. */
export function chooseTreeExportRasterSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError("Некорректный размер изображения.");
  }
  const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(16_000_000 / width / height));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export function createTreeExportFilename(title: string, style: TreeExportStyle, format: TreeExportFormat) {
  const name = title.normalize("NFKC").replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "семья";
  const suffix: Record<TreeExportStyle, string> = { tree: "дерево", circle: "круг", pyramid: "пирамида" };
  return `Rodovo-${name}-${suffix[style]}.${format}`;
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Экспорт отменён.", "AbortError");
}

function loadSvgImage(svg: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();
    let timeout: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener("abort", abort);
      URL.revokeObjectURL(url);
    };
    const abort = () => {
      cleanup();
      image.src = "";
      reject(new DOMException("Экспорт отменён.", "AbortError"));
    };
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = () => { cleanup(); reject(new Error("Не удалось подготовить изображение. Попробуйте ещё раз.")); };
    signal?.addEventListener("abort", abort, { once: true });
    timeout = setTimeout(() => {
      cleanup();
      image.src = "";
      reject(new Error("Подготовка изображения заняла слишком много времени. Попробуйте ещё раз."));
    }, 15_000);
    image.src = url;
  });
}

export async function renderTreeExportBlob(artwork: TreeExportArtwork, format: TreeExportFormat, signal?: AbortSignal): Promise<Blob> {
  checkAbort(signal);
  const size = chooseTreeExportRasterSize(artwork.width, artwork.height);
  const image = await loadSvgImage(artwork.svg, signal);
  checkAbort(signal);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Браузер не смог создать изображение. Попробуйте другой браузер.");
    context.fillStyle = "#fbf8f1";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    const mimeType = format === "png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error("Недостаточно памяти для экспорта. Попробуйте скрыть часть людей."));
      }, mimeType, 0.96);
    });
    checkAbort(signal);
    if (blob.type !== mimeType) throw new Error("Браузер не поддерживает выбранный формат изображения.");
    if (format === "png") return blob;
    const { buildJpegPdf } = await import("@/lib/jpeg-pdf");
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    checkAbort(signal);
    const pdf = buildJpegPdf(jpeg, size.width, size.height);
    return new Blob([pdf], { type: "application/pdf" });
  } finally {
    // Release the large backing store promptly, including on cancellation/errors.
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function downloadTreeExport(artwork: TreeExportArtwork, title: string, style: TreeExportStyle, format: TreeExportFormat, signal?: AbortSignal) {
  const blob = await renderTreeExportBlob(artwork, format, signal);
  checkAbort(signal);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = createTreeExportFilename(title, style, format);
  try {
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Keep the URL alive until the browser has accepted the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
