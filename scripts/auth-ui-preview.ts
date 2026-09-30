// Standalone synthetic fixture. It never loads the application server or a database.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const result = await build({
    absWorkingDir: projectRoot,
    entryPoints: ["tests/fixtures/auth-ui.tsx"],
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "synthetic-auth-next-link", setup(builder) {
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "auth-preview" }));
      builder.onLoad({ filter: /.*/, namespace: "auth-preview" }, () => ({ contents: 'import React from "react"; export default function Link({children, ...props}) { return React.createElement("a", props, children); }', resolveDir: projectRoot }));
    } }],
  });
  const javascript = result.outputFiles[0].contents;
  const globals = await readFile(path.join(projectRoot, "app/globals.css"), "utf8");
  const treeCss = await readFile(path.join(projectRoot, "components/tree-export.css"), "utf8");
  const css = globals.replace('@import "../components/tree-export.css";', treeCss);
  const html = '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Изолированная проверка аккаунта</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="root"></main><script src="/fixture.js"></script></body></html>';
  const pages = ["/", "/auth-ui", "/account", "/forgot-password", "/reset-password", "/verify-email", "/invitations/accept", "/login", "/register", "/families", "/onboarding/family", "/family/synthetic"];
  createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data: blob:; frame-ancestors 'none'; form-action 'none'");
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1:3001").pathname;
    if (request.method !== "GET" || ![...pages, "/fixture.js", "/fixture.css"].includes(pathname)) {
      response.writeHead(404).end("Only isolated UI fixture assets are served."); return;
    }
    response.setHeader("Content-Type", pathname === "/fixture.js" ? "text/javascript; charset=utf-8" : pathname === "/fixture.css" ? "text/css; charset=utf-8" : "text/html; charset=utf-8");
    response.end(pathname === "/fixture.js" ? javascript : pathname === "/fixture.css" ? css : html);
  }).listen(3001, "127.0.0.1", () => console.log("Isolated account UI fixture ready: http://127.0.0.1:3001/auth-ui"));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
