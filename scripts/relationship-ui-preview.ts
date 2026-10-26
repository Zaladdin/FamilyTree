// Standalone developer fixture. No Next.js server, auth bypass, or database import.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const result = await build({
    absWorkingDir: projectRoot,
    entryPoints: { fixture: "tests/fixtures/relationship-ui.tsx", "archive-ui": "tests/fixtures/archive-ui.tsx" },
    outdir: "tmp/isolated-ui-bundle",
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{
      name: "isolated-next-shims",
      setup(builder) {
        builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: path.join(projectRoot, "tests/fixtures/relationship-ui-navigation.tsx") }));
        builder.onResolve({ filter: /^next\/(link|image)$/ }, (args) => ({ path: args.path, namespace: "next-fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "next-fixture" }, (args) => ({
          contents: args.path === "next/link"
            ? 'export { FixtureLink as default } from "./tests/fixtures/relationship-ui-navigation";'
            : 'import React from "react"; export default function Image({unoptimized, ...props}) { return React.createElement("img", props); }',
          resolveDir: projectRoot,
        }));
      },
    }],
  });
  const outputs = new Map(result.outputFiles.map((file) => [path.basename(file.path), file.contents]));
  const globals = await readFile(path.join(projectRoot, "app/globals.css"), "utf8");
  const exportCss = await readFile(path.join(projectRoot, "components/tree-export.css"), "utf8");
  const css = globals.replace('@import "../components/tree-export.css";', exportCss);
  const html = (entry: string) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Изолированная проверка семейного архива</title><link rel="stylesheet" href="/${entry}.css"></head><body><div id="root"></div><script src="/${entry}.js"></script></body></html>`;
  createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data: blob:; frame-ancestors 'none'; form-action 'none'");
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1:3001").pathname;
    if (request.method !== "GET" || !["/", "/relationship-ui", "/archive-ui", "/fixture.js", "/fixture.css", "/archive-ui.js", "/archive-ui.css"].includes(pathname)) {
      response.writeHead(404).end("Only isolated UI fixture assets are served.");
      return;
    }
    const entry = pathname.startsWith("/archive-ui") ? "archive-ui" : "fixture";
    response.setHeader("Content-Type", pathname.endsWith(".js") ? "text/javascript; charset=utf-8" : pathname.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8");
    response.end(pathname.endsWith(".js") ? outputs.get(`${entry}.js`) : pathname.endsWith(".css") ? css + "\n" + Buffer.from(outputs.get(`${entry}.css`) ?? []).toString("utf8") : html(entry));
  }).listen(3001, "127.0.0.1", () => console.log("Isolated relationship UI fixture ready: http://127.0.0.1:3001/relationship-ui"));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
