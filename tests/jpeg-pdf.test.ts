import test from "node:test";
import assert from "node:assert/strict";
import { buildJpegPdf } from "@/lib/jpeg-pdf";

const jpeg = Uint8Array.of(255, 216, 255, 224, 0, 16, 0, 128, 200, 255, 217);

test("PDF embeds original JPEG bytes with matching stream length and resolvable byte offsets", () => {
  const pdf = buildJpegPdf(jpeg, 2400, 1600);
  const source = Buffer.from(pdf).toString("latin1");
  assert.ok(source.startsWith("%PDF-1.4"));
  assert.match(source, /\/Filter \/DCTDecode/);
  assert.match(source, /\/Width 2400 \/Height 1600/);
  assert.match(source, /\/Count 1/);
  const streamStart = source.indexOf("stream\n", source.indexOf("/Subtype /Image")) + 7;
  assert.deepEqual(pdf.slice(streamStart, streamStart + jpeg.length), jpeg);
  assert.match(source.slice(source.indexOf("/Subtype /Image"), streamStart), new RegExp(`/Length ${jpeg.length}\\b`));
  const startxref = Number(source.match(/startxref\n(\d+)\n%%EOF/)?.[1]);
  assert.equal(source.slice(startxref, startxref + 4), "xref");
  const entries = source.slice(startxref).split("\n").slice(3, 8);
  assert.equal(entries.length, 5);
  entries.forEach((entry, index) => {
    assert.match(entry, /^\d{10} 00000 n $/);
    assert.equal(source.slice(Number(entry.slice(0, 10)), Number(entry.slice(0, 10)) + 7), `${index + 1} 0 obj`);
  });
});

test("PDF selects A3 orientation, keeps aspect ratio and centres the image inside print margins", () => {
  for (const [width, height] of [[2400, 1600], [1200, 2600], [1000, 1000]]) {
    const source = Buffer.from(buildJpegPdf(jpeg, width, height)).toString("latin1");
    const page = source.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)!;
    const pageWidth = Number(page[1]);
    const pageHeight = Number(page[2]);
    assert.ok(width >= height ? pageWidth > pageHeight : pageWidth < pageHeight);
    assert.ok(Math.abs(Math.max(pageWidth, pageHeight) - 1190.55) < 0.1);
    assert.ok(Math.abs(Math.min(pageWidth, pageHeight) - 841.89) < 0.1);
    const transform = source.match(/([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/)!;
    const [drawWidth, drawHeight, x, y] = transform.slice(1).map(Number);
    assert.ok(Math.abs(drawWidth / drawHeight - width / height) < 0.0001);
    assert.ok(x >= 28 && y >= 28 && x + drawWidth <= pageWidth - 27.99 && y + drawHeight <= pageHeight - 27.99);
    assert.ok(Math.abs(x * 2 + drawWidth - pageWidth) < 0.02 && Math.abs(y * 2 + drawHeight - pageHeight) < 0.02);
  }
});

test("PDF rejects non-JPEG bytes and non-positive, fractional, non-finite or excessive image dimensions", () => {
  for (const size of [0, -1, 0.5, NaN, Infinity, 65536]) assert.throws(() => buildJpegPdf(jpeg, size, 100));
  assert.throws(() => buildJpegPdf(jpeg, 100, 0));
  assert.throws(() => buildJpegPdf(new Uint8Array(), 100, 100));
  assert.throws(() => buildJpegPdf(Uint8Array.of(1, 2, 3, 4), 100, 100));
});
