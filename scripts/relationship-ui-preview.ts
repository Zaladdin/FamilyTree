// Standalone developer fixture. No Next.js server, auth bypass, or database import.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const result = await build({
    absWorkingDir: projectRoot,
    entryPoints: ["tests/fixtures/relationship-ui.tsx"],
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{
      name: "isolated-next-shims",
      setup(builder) {
        builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: path.join(projectRoot, "tests/fixtures/relationship-ui-navigation.tsx") }));
        builder.onResolve({ filter: /^next\/(link|image)$/ }, (args) => ({ path: args.path, namespace: "next-fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "next-fixture" }, (args) => ({
          contents: args.path === "next/link"
            ? 'import React from "react"; export default function Link({children, ...props}) { return React.createElement("a", props, children); }'
            : 'import React from "react"; export default function Image({unoptimized, ...props}) { return React.createElement("img", props); }',
          resolveDir: projectRoot,
        }));
      },
    }],
  });
  const javascript = result.outputFiles[0].contents;
  const globals = await readFile(path.join(projectRoot, "app/globals.css"), "utf8");
  const exportCss = await readFile(path.join(projectRoot, "components/tree-export.css"), "utf8");
  const css = globals.replace('@import "../components/tree-export.css";', exportCss);
  const html = '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Изолированная проверка родственных связей</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="root"></main><script src="/fixture.js"></script></body></html>';
  createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data: blob:; frame-ancestors 'none'; form-action 'none'");
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1:3001").pathname;
    if (request.method !== "GET" || !["/", "/relationship-ui", "/fixture.js", "/fixture.css"].includes(pathname)) {
      response.writeHead(404).end("Only isolated UI fixture assets are served.");
      return;
    }
    response.setHeader("Content-Type", pathname === "/fixture.js" ? "text/javascript; charset=utf-8" : pathname === "/fixture.css" ? "text/css; charset=utf-8" : "text/html; charset=utf-8");
    response.end(pathname === "/fixture.js" ? javascript : pathname === "/fixture.css" ? css : html);
  }).listen(3001, "127.0.0.1", () => console.log("Isolated relationship UI fixture ready: http://127.0.0.1:3001/relationship-ui"));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
