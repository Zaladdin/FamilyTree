import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chooseTreeExportRasterSize, createTreeExportFilename, renderTreeExportBlob, downloadTreeExport } from "@/lib/tree-export-download";

test("export raster is high-resolution without exceeding the browser memory or side limits", () => {
  assert.deepEqual(chooseTreeExportRasterSize(1200, 900), { width: 2400, height: 1800 });
  for (const [width, height] of [[9000, 9000], [50000, 400], [200, 90000], [1600, 100000], [1, 1]]) {
    const size = chooseTreeExportRasterSize(width, height);
    assert.ok(size.width >= 1 && size.height >= 1);
    assert.ok(size.width <= 8192 && size.height <= 8192);
    assert.ok(size.width * size.height <= 16_000_000);
    if (size.width > 2 && size.height > 2) assert.ok(Math.abs(size.width / size.height / (width / height) - 1) < 0.03);
  }
});

const artwork = { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"/>', width: 100, height: 80 };

function fakeBrowser(t: TestContext, options: { imageFails?: boolean; noContext?: boolean; noBlob?: boolean; beforeBlob?: () => void } = {}) {
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, "Image");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  let downloads = 0;
  const drawCalls: unknown[][] = [];
  const canvas = {
    width: 0, height: 0,
    getContext: () => options.noContext ? null : {
      fillStyle: "", fillRect: () => {}, drawImage: (...args: unknown[]) => drawCalls.push(args),
    },
    toBlob: (callback: BlobCallback, type: string) => {
      options.beforeBlob?.();
      callback(options.noBlob ? null : new Blob(["image"], { type }));
    },
  };
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) {
      if (!value) return;
      queueMicrotask(() => options.imageFails ? this.onerror?.() : this.onload?.());
    }
  }
  Object.defineProperty(globalThis, "Image", { configurable: true, value: FakeImage });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: (name: string) => name === "canvas" ? canvas : { click: () => { downloads += 1; }, remove: () => {} },
    body: { appendChild: () => {} },
  } });
  const urls = t.mock.method(URL, "createObjectURL", () => "blob:local-export");
  const revoked = t.mock.method(URL, "revokeObjectURL", () => {});
  t.after(() => {
    if (originalImage) Object.defineProperty(globalThis, "Image", originalImage); else Reflect.deleteProperty(globalThis, "Image");
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument); else Reflect.deleteProperty(globalThis, "document");
  });
  return { canvas, drawCalls, urls, revoked, downloads: () => downloads };
}

test("PNG rasterization stays local and releases image URL and canvas backing store", async (t) => {
  const browser = fakeBrowser(t);
  const blob = await renderTreeExportBlob(artwork, "png");
  assert.equal(blob.type, "image/png");
  assert.deepEqual(browser.drawCalls[0].slice(1), [0, 0, 200, 160]);
  assert.equal(browser.revoked.mock.callCount(), 1);
  assert.equal(browser.canvas.width, 0);
  assert.equal(browser.canvas.height, 0);
});

test("failed SVG loading reports a recoverable error and releases its URL", async (t) => {
  const browser = fakeBrowser(t, { imageFails: true });
  await assert.rejects(renderTreeExportBlob(artwork, "png"), /Не удалось подготовить изображение/);
  assert.equal(browser.revoked.mock.callCount(), 1);
});

test("unavailable canvas reports an error and releases its backing store", async (t) => {
  const browser = fakeBrowser(t, { noContext: true });
  await assert.rejects(renderTreeExportBlob(artwork, "png"), /Браузер не смог создать изображение/);
  assert.equal(browser.canvas.width, 0);
  assert.equal(browser.canvas.height, 0);
});

test("null image encoding reports an error and releases its backing store", async (t) => {
  const browser = fakeBrowser(t, { noBlob: true });
  await assert.rejects(renderTreeExportBlob(artwork, "png"), /Недостаточно памяти/);
  assert.equal(browser.canvas.width, 0);
  assert.equal(browser.canvas.height, 0);
});

test("cancelled export does not load images or create downloads", async (t) => {
  const browser = fakeBrowser(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(downloadTreeExport(artwork, "Семья", "tree", "png", controller.signal), { name: "AbortError" });
  assert.equal(browser.urls.mock.callCount(), 0);
  assert.equal(browser.downloads(), 0);
});

test("closing while canvas encodes aborts a pending download and releases resources", async (t) => {
  const controller = new AbortController();
  const browser = fakeBrowser(t, { beforeBlob: () => controller.abort() });
  await assert.rejects(downloadTreeExport(artwork, "Семья", "tree", "png", controller.signal), { name: "AbortError" });
  assert.equal(browser.downloads(), 0);
  assert.equal(browser.revoked.mock.callCount(), 1);
  assert.equal(browser.canvas.width, 0);
});

test("export rejects zero, negative, and non-finite source dimensions", () => {
  for (const value of [0, -1, NaN, Infinity, -Infinity]) {
    assert.throws(() => chooseTreeExportRasterSize(value, 100), RangeError);
    assert.throws(() => chooseTreeExportRasterSize(100, value), RangeError);
  }
});

test("download filename keeps Russian names but removes paths, control characters, and excessive length", () => {
  assert.equal(createTreeExportFilename("Род Ахмедовых", "tree", "png"), "Rodovo-Род-Ахмедовых-дерево.png");
  assert.equal(createTreeExportFilename("../a\\b:*?\"<>|\u0000", "circle", "pdf"), "Rodovo-a-b-круг.pdf");
  assert.equal(createTreeExportFilename(" ... ", "tree", "pdf"), "Rodovo-семья-дерево.pdf");
  assert.ok(createTreeExportFilename("Д".repeat(1000), "circle", "png").length < 100);
});

test("pyramid filenames distinguish both downloadable formats from circle and tree", () => {
  assert.equal(createTreeExportFilename("Род Ахмедовых", "pyramid", "png"), "Rodovo-Род-Ахмедовых-пирамида.png");
  assert.equal(createTreeExportFilename("Род Ахмедовых", "pyramid", "pdf"), "Rodovo-Род-Ахмедовых-пирамида.pdf");
});
