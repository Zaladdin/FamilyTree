import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { assertTestDatabaseUrl, UNIT_DATABASE_URL } from "./test-environment";

export type RecoveryHttpInput = {
  databaseUrl: string; storageRoot: string; email: string; password: string;
  familySlug: string; familyName: string; personId: string;
  photoId: string; audioId: string; photoBytes: Buffer; audioBytes: Buffer;
  nonReadyMediaIds?: string[];
};

export function assertRecoveryHttpDatabase(value: string): string {
  const url = new URL(assertTestDatabaseUrl(value, UNIT_DATABASE_URL));
  if (url.hostname !== "127.0.0.1" || url.port !== "55432" ||
      url.pathname !== "/rodovo_recovery_test" || url.search || url.hash) {
    throw new Error("Recovery HTTP requires the disposable loopback recovery database.");
  }
  return url.toString();
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  if (await Promise.race([exited.then(() => true), delay(5000).then(() => false)])) return;
  child.kill("SIGKILL");
  if (!await Promise.race([exited.then(() => true), delay(5000).then(() => false)])) {
    throw new Error("Recovery HTTP server did not stop.");
  }
}

/** Real HTTP checks against restored synthetic data; this is not browser QA. */
export async function runRecoveryHttpSmoke(input: RecoveryHttpInput): Promise<void> {
  const databaseUrl = assertRecoveryHttpDatabase(input.databaseUrl);
  assert.ok(path.isAbsolute(input.storageRoot), "Recovery storage must be absolute.");
  assert.ok(input.audioBytes.length >= 4, "Recovery audio fixture is too short.");
  const project = path.resolve(__dirname, "..");
  await lstat(path.join(project, ".next", "BUILD_ID"));
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(3002, "127.0.0.1", () => server.close((error) => error ? reject(error) : resolve()));
  });
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(parent, "rodovo-recovery-http-"));
  const links: string[] = [];
  let child: ChildProcess | undefined;
  let stage = "startup";
  try {
    for (const name of [".next", "node_modules"]) {
      const link = path.join(root, name);
      await symlink(path.join(project, name), link, process.platform === "win32" ? "junction" : "dir");
      links.push(link);
    }
    await mkdir(path.join(root, "app"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ private: true, name: "rodovo-recovery-http", version: "0.0.0" }));
    // The disposable project has no .env files. Explicit DATABASE_URL also wins
    // over the generated Prisma client's environment-file discovery.
    const env: NodeJS.ProcessEnv = {
      ...process.env, NODE_ENV: "production", DATABASE_URL: databaseUrl,
      REDIS_URL: "", OPS_METRICS_TOKEN: "", MEDIA_STORAGE_ROOT: input.storageRoot,
      NEXT_TELEMETRY_DISABLED: "1", NODE_OPTIONS: "",
    };
    delete env.TEST_DATABASE_URL;
    let spawnFailed = false;
    child = spawn(process.execPath, [path.join(project, "node_modules", "next", "dist", "bin", "next"), "start", root, "--hostname", "127.0.0.1", "--port", "3002"], {
      cwd: root, env, shell: false, windowsHide: true, stdio: "ignore",
    });
    child.once("error", () => { spawnFailed = true; });
    const base = "http://127.0.0.1:3002";
    const request = (pathname: string, init?: RequestInit) => fetch(base + pathname, { ...init, signal: AbortSignal.timeout(15000), redirect: "manual" });
    const deadline = Date.now() + 30000;
    let started = false;
    while (Date.now() < deadline) {
      if (spawnFailed || child.exitCode !== null || child.signalCode !== null) throw new Error("Server exited.");
      try {
        const response = await request("/api/health/live");
        started = response.status === 200 && (await response.json()).status === "alive";
        if (started) break;
      } catch { /* Only the bounded startup poll tolerates connection errors. */ }
      await delay(200);
    }
    assert.ok(started);
    stage = "login";
    const familyPath = `/family/${encodeURIComponent(input.familySlug)}`;
    const form = new URLSearchParams({ email: input.email, password: input.password, redirectTo: familyPath });
    const login = await request("/api/auth/login", { method: "POST", headers: { origin: base }, body: form });
    assert.equal(login.status, 303);
    assert.equal(login.headers.get("location"), base + familyPath);
    const cookie = login.headers.getSetCookie().map((value) => value.split(";", 1)[0]).find((value) => value.startsWith("rodovo_session="));
    assert.ok(cookie);
    await login.body?.cancel();
    stage = "family";
    const family = await request(familyPath, { headers: { cookie } });
    assert.equal(family.status, 200);
    assert.ok((await family.text()).includes(input.familyName));
    const mediaPath = (id: string) => `/api/family/${encodeURIComponent(input.familySlug)}/people/${encodeURIComponent(input.personId)}/media/${encodeURIComponent(id)}`;
    stage = "anonymous-media";
    const anonymous = await request(mediaPath(input.photoId));
    assert.equal(anonymous.status, 401);
    await anonymous.body?.cancel();
    stage = "photo";
    const photo = await request(mediaPath(input.photoId), { headers: { cookie } });
    assert.equal(photo.status, 200);
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), input.photoBytes);
    stage = "audio-range";
    const audio = await request(mediaPath(input.audioId), { headers: { cookie, range: "bytes=0-3" } });
    assert.equal(audio.status, 206);
    assert.equal(audio.headers.get("content-range"), `bytes 0-3/${input.audioBytes.length}`);
    assert.deepEqual(Buffer.from(await audio.arrayBuffer()), input.audioBytes.subarray(0, 4));
    stage = "non-ready-media";
    for (const id of input.nonReadyMediaIds ?? []) {
      const unavailable = await request(mediaPath(id), { headers: { cookie } });
      assert.equal(unavailable.status, 404);
      await unavailable.body?.cancel();
    }
  } catch {
    // Never surface HTTP bodies, cookies, credentials or child output.
    throw new Error(`Recovery HTTP failed at ${stage}.`);
  } finally {
    if (child) await stop(child);
    const target = await realpath(root);
    if (path.dirname(target) !== parent || !path.basename(target).startsWith("rodovo-recovery-http-")) throw new Error("Unsafe recovery HTTP cleanup target.");
    for (const link of links) {
      if (!(await lstat(link)).isSymbolicLink()) throw new Error("Recovery HTTP link changed; cleanup refused.");
      await rm(link, { maxRetries: 3, retryDelay: 200 });
    }
    await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
  console.log("Recovery HTTP PASS: real login, restored family, protected photo bytes and audio range; temporary server cleaned up.");
}
