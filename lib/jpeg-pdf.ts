/** A small browser-safe PDF writer for the RGB JPEG produced by canvas.toBlob. */
export function buildJpegPdf(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  if (![width, height].every((value) => Number.isInteger(value) && value > 0 && value <= 65535)) {
    throw new Error("Некорректный размер изображения для PDF.");
  }
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[jpeg.length - 2] !== 0xff || jpeg[jpeg.length - 1] !== 0xd9) {
    throw new Error("Не удалось подготовить JPEG для PDF.");
  }
  // A3 in PostScript points. Keep the complete poster within a 10 mm margin.
  const [pageWidth, pageHeight] = width >= height ? [1190.55, 841.89] : [841.89, 1190.55];
  const margin = 28.35;
  const scale = Math.min((pageWidth - margin * 2) / width, (pageHeight - margin * 2) / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  const number = (value: number) => value.toFixed(4).replace(/\.?0+$/, "");
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets = [0];
  let length = 0;
  const append = (value: string | Uint8Array) => {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string) => {
    offsets[id] = length;
    append(`${id} 0 obj\n${body}\nendobj\n`);
  };
  append("%PDF-1.4\n");
  append(Uint8Array.of(37, 226, 227, 207, 211, 10));
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Poster 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = length;
  append(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  append(jpeg);
  append("\nendstream\nendobj\n");
  const content = `q\n${number(drawWidth)} 0 0 ${number(drawHeight)} ${number((pageWidth - drawWidth) / 2)} ${number((pageHeight - drawHeight) / 2)} cm\n/Poster Do\nQ\n`;
  object(5, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
  const xref = length;
  append(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const result = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) {
    result.set(chunk, position);
    position += chunk.length;
  }
  return result;
}
