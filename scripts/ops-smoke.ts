import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { UNIT_DATABASE_URL } from "./test-environment";

async function requireFreePort(port: number) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close((error) => error ? reject(error) : resolve()));
  });
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  if (await Promise.race([exited.then(() => true), delay(5000).then(() => false)])) return;
  child.kill("SIGKILL");
  if (!await Promise.race([exited.then(() => true), delay(5000).then(() => false)])) throw new Error("Smoke server did not stop.");
}

async function main() {
  const project = path.resolve(__dirname, "..");
  const build = path.join(project, ".next");
  await lstat(path.join(build, "BUILD_ID"));
  const port = 3002;
  await requireFreePort(port);
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(parent, "rodovo-ops-smoke-"));
  const links: string[] = [];
  let child: ChildProcess | undefined;
  try {
    // Next loads .env from its project directory. A new synthetic directory has
    // no environment files and no family data; only compiled code is linked in.
    for (const [name, source] of [[".next", build], ["node_modules", path.join(project, "node_modules")]]) {
      const link = path.join(root, name);
      await symlink(source, link, process.platform === "win32" ? "junction" : "dir");
      links.push(link);
    }
    await mkdir(path.join(root, "app"));
    await mkdir(path.join(root, "storage"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ private: true, name: "rodovo-isolated-smoke", version: "0.0.0" }));
    const token = randomBytes(32).toString("hex");
    const env: NodeJS.ProcessEnv = {
      ...process.env, NODE_ENV: "production", DATABASE_URL: UNIT_DATABASE_URL, REDIS_URL: "",
      OPS_METRICS_TOKEN: token, MEDIA_STORAGE_ROOT: path.join(root, "storage"), OPS_MIN_FREE_STORAGE_BYTES: "1",
      NEXT_TELEMETRY_DISABLED: "1", NODE_OPTIONS: "",
    };
    delete env.TEST_DATABASE_URL;
    let output = "";
    let spawnFailed = false;
    child = spawn(process.execPath, [path.join(project, "node_modules", "next", "dist", "bin", "next"), "start", root, "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: root, env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    child.once("error", () => { spawnFailed = true; });
    const capture = (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-1024 * 1024); };
    child.stdout!.on("data", capture); child.stderr!.on("data", capture);
    const base = `http://127.0.0.1:${port}`;
    const request = (pathname: string, init?: RequestInit) => fetch(base + pathname, { ...init, signal: AbortSignal.timeout(5000), redirect: "manual" });
    const deadline = Date.now() + 30_000;
    let started = false;
    while (Date.now() < deadline) {
      if (spawnFailed || child.exitCode !== null || child.signalCode !== null) throw new Error("Smoke server stopped before readiness.");
      try {
        const response = await request("/api/health/live");
        if (response.status === 200 && (await response.json()).status === "alive") { started = true; break; }
        await response.body?.cancel();
      } catch { /* Startup only; no request leaves loopback. */ }
      await delay(200);
    }
    assert.equal(started, true, "Liveness did not become available.");
    const live = await request("/api/health/live");
    assert.deepEqual(await live.json(), { status: "alive" });
    assert.match(live.headers.get("x-request-id") ?? "", /^[a-f0-9-]{36}$/);
    const ready = await request("/api/health/ready");
    assert.equal(ready.status, 503); assert.deepEqual(await ready.json(), { status: "not_ready" });
    const unauthorized = await request("/api/ops/metrics");
    assert.equal(unauthorized.status, 404); await unauthorized.body?.cancel();
    const metrics = await request("/api/ops/metrics", { headers: { authorization: `Bearer ${token}` } });
    assert.equal(metrics.status, 200);
    const report = await metrics.json();
    assert.equal(report.readiness.ready, false);
    assert.equal(report.readiness.checks.storage.state, "ok");
    assert.equal(report.readiness.checks.redis.state, "disabled");
    const failed = await request("/api/family/private-smoke-slug/people/private-smoke-person/media/private-smoke-file?secret=private-smoke-query", {
      headers: { cookie: "rodovo_session=private-smoke-cookie", "x-request-id": "private-smoke-injected-id" },
    });
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: "Не удалось открыть медиафайл." });
    await delay(100);
    assert.match(output, /"event":"readiness_degraded"/);
    assert.match(output, /"status":500/);
    for (const secret of [token, UNIT_DATABASE_URL, "private-smoke-slug", "private-smoke-query", "private-smoke-cookie", "private-smoke-injected-id"]) assert.ok(!output.includes(secret), "Operational logs leaked an input.");
    console.log("OPS smoke PASS: isolated production server, live=200, unavailable DB ready=503, protected metrics, safe 500, degradation event. No production database, migrations or mail.");
  } finally {
    if (child) await stop(child);
    const target = await realpath(root);
    if (path.dirname(target) !== parent || !path.basename(target).startsWith("rodovo-ops-smoke-")) throw new Error("Unsafe smoke cleanup target.");
    for (const link of links) {
      if (!(await lstat(link)).isSymbolicLink()) throw new Error("Smoke link changed; cleanup refused.");
      await rm(link);
    }
    await rm(target, { recursive: true, force: true });
  }
}

void main().catch(() => {
  // Neither captured server output nor filesystem/connection details cross this boundary.
  console.error("OPS smoke FAIL. Check the isolated build, loopback port 3002 and operational regression tests. No private diagnostics printed.");
  process.exitCode = 1;
});
