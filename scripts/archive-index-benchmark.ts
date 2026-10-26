import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, readFile, writeFile, realpath, lstat, symlink, rm, stat } from "node:fs/promises";
import { tmpdir, cpus, totalmem } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { getArchiveBenchmarkEnvironment } from "./archive-index-benchmark-environment";

const INDEX = "Person_familyId_isArchived_id_idx";
const MIGRATION = "20261025000000_archive_pagination_index";
const LOADER_ROUNDS = 30;
const HTTP_ROUNDS = 20;
type CapturedQuery = { query: string; params: string };
type Scenario = { name: string; slug: string; query: { after?: string; before?: string } };
type ScenarioResult = { name: string; loaderMs: number[]; httpMs: number[]; ttfbMs: number[]; jsonBytes: number; httpBytes: number; resultHash: string; plans: unknown[] };
type Phase = { name: string; indexed: boolean; indexBuildMs?: number; scenarios: ScenarioResult[] };

function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return { n: values.length, p50: percentile(0.5), p95: percentile(0.95), min: sorted[0], max: sorted.at(-1) };
}

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  if (await Promise.race([exited.then(() => true), delay(5000).then(() => false)])) return;
  child.kill("SIGKILL");
  assert.equal(await Promise.race([exited.then(() => true), delay(5000).then(() => false)]), true);
}

let stage = "configuration";
async function main() {
  assert.equal(process.argv.length, 2, "No CLI arguments are accepted.");
  const env = getArchiveBenchmarkEnvironment(process.env);
  process.env.DATABASE_URL = env.DATABASE_URL;
  process.env.TEST_DATABASE_URL = env.TEST_DATABASE_URL;
  Object.assign(process.env, { NODE_ENV: "test" });
  const token = env.ARCHIVE_BENCHMARK_TOKEN!;
  const project = process.cwd();
  const runId = Date.now();
  const reportPath = path.join(project, "docs/benchmarks/archive-index-2026-10-25.json");
  await assert.rejects(stat(reportPath), { code: "ENOENT" }, "Never overwrite existing benchmark evidence.");
  const { PrismaClient, Prisma } = await import("@prisma/client");
  const client = new PrismaClient({ datasourceUrl: env.DATABASE_URL, log: [{ emit: "event", level: "query" }] });
  let capture: CapturedQuery[] | null = null;
  // No console/file SQL logging in timed sections. Identical event instrumentation in A/B.
  client.$on("query", (event) => { capture?.push({ query: event.query, params: event.params }); });
  const globalPrisma = globalThis as { prisma?: typeof client };
  const previousPrisma = globalPrisma.prisma;
  globalPrisma.prisma = client;
  let httpChild: ChildProcess | undefined;
  let httpRoot: string | undefined;
  let originalFingerprint: unknown;
  const scratchParent = await realpath(tmpdir());

  async function assertOwner() {
    const rows = await client.$queryRaw<{ name: string; address: string; port: number; marker: string }[]>`
      SELECT current_database() AS name, host(inet_server_addr()) AS address,
        inet_server_port() AS port, shobj_description(oid, 'pg_database') AS marker
      FROM pg_database WHERE datname = current_database()`;
    assert.equal(rows[0]?.name, "rodovo_ci_test");
    assert.equal(rows[0]?.address, "127.0.0.1");
    assert.equal(rows[0]?.port, Number(new URL(env.TEST_DATABASE_URL!).port));
    assert.equal(rows[0]?.marker, `rodovo-archive-index-test:${token}`);
  }

  async function indexState() {
    return client.$queryRaw<{ valid: boolean; ready: boolean; bytes: bigint; definition: string }[]>`
      SELECT i.indisvalid AS valid, i.indisready AS ready, pg_relation_size(i.indexrelid) AS bytes,
        pg_get_indexdef(i.indexrelid) AS definition
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = ${INDEX} AND n.nspname = 'public'`;
  }

  async function fingerprint() {
    return client.$queryRaw<{ count: string; checksum: string }[]>`
      SELECT count(*)::text AS count,
        sum(hashtextextended(row_to_json(p)::text, 0)::numeric)::text AS checksum FROM "Person" p`;
  }

  try {
    stage = "ownership";
    await assertOwner();
    const existing = await client.person.count();
    const existingFamilies = await client.family.count();
    assert.equal(existing, 0, "Benchmark requires an empty disposable database.");
    assert.equal(existingFamilies, 0, "Benchmark requires an empty disposable database.");
    const initialIndex = await indexState();
    assert.equal(initialIndex.length, 1, "Deploy and validate migrations first.");
    assert.ok(initialIndex[0].valid && initialIndex[0].ready);
    const migrationSql = await readFile(path.join(project, "prisma/migrations", MIGRATION, "migration.sql"), "utf8");
    assert.match(migrationSql, /CREATE INDEX "Person_familyId_isArchived_id_idx" ON "Person"\("familyId", "isArchived", "id"\);/);
    const migrationHash = createHash("sha256").update(migrationSql).digest("hex");

    stage = "synthetic fixture";
    const targets = [
      { id: "bench-small", total: 1000, archivedPercent: 50 },
      { id: "bench-medium", total: 20000, archivedPercent: 50 },
      { id: "bench-large-archived", total: 100000, archivedPercent: 90 },
      { id: "bench-large-active", total: 100000, archivedPercent: 10 },
    ];
    const families = [...targets, ...Array.from({ length: 20 }, (_, index) => ({ id: `bench-background-${index}`, total: 10000, archivedPercent: 50 }))];
    await client.family.createMany({ data: families.map((family) => ({
      id: family.id, slug: family.id, title: `Synthetic ${family.id}`, surname: "Synthetic",
      description: "Disposable benchmark only", region: "Synthetic", coverQuote: "",
      peopleCount: family.total * (100 - family.archivedPercent) / 100,
    })) });
    for (const family of families) {
      await client.$executeRaw(Prisma.sql`
        INSERT INTO "Person" ("id", "familyId", "firstName", "lastName", "gender", "birthDate",
          "birthPlace", "status", "isArchived", "biography", "updatedAt")
        SELECT md5(${family.id} || ':' || s::text), ${family.id}, 'Synthetic', 'Record ' || s::text,
          'male'::"Gender", '1900', 'Synthetic', 'living'::"PersonStatus",
          (s % 100) < ${family.archivedPercent}, repeat(md5(s::text), 16), CURRENT_TIMESTAMP
        FROM generate_series(1, ${family.total}::int) s`);
    }
    await client.$executeRawUnsafe('ANALYZE "Person"');
    await client.$executeRawUnsafe('ANALYZE "Family"');
    assert.equal(await client.person.count(), 421000);
    originalFingerprint = await fingerprint();
    const { getFamilyArchivePage } = await import("../lib/family-archive-reader");
    const { hashPassword } = await import("../lib/auth");
    const password = "synthetic-archive-benchmark-password";
    const email = "archive-benchmark@example.invalid";
    const user = await client.user.create({ data: { firstName: "Synthetic", lastName: "Benchmark", email,
      passwordHash: await hashPassword(password), emailVerifiedAt: new Date() } });
    await client.familyMembership.createMany({ data: targets.map((family) => ({ familyId: family.id, userId: user.id, name: "Synthetic Benchmark", role: "owner" })) });
    const scenarios: Scenario[] = [];
    for (const family of targets) {
      scenarios.push({ name: `${family.id}/first`, slug: family.id, query: {} });
      if (family.id === "bench-large-archived" || family.id === "bench-large-active") {
        const ids = await client.person.findMany({ where: { familyId: family.id, isArchived: true }, orderBy: { id: "asc" }, select: { id: true } });
        scenarios.push({ name: `${family.id}/deep-forward`, slug: family.id, query: { after: ids[Math.floor(ids.length * 0.9)].id } });
        if (family.id === "bench-large-archived") {
          scenarios.push({ name: `${family.id}/middle-forward`, slug: family.id, query: { after: ids[Math.floor(ids.length * 0.5)].id } });
          scenarios.push({ name: `${family.id}/middle-backward`, slug: family.id, query: { before: ids[Math.floor(ids.length * 0.5)].id } });
        }
      }
    }

    stage = "correctness";
    const expected = new Map<string, string>();
    for (const scenario of scenarios) {
      const value = await getFamilyArchivePage(scenario.slug, scenario.query);
      assert.equal(value?.archivedPeople.length, 24);
      expected.set(scenario.name, createHash("sha256").update(JSON.stringify(value)).digest("hex"));
    }
    const anchorScenario = scenarios.find((scenario) => scenario.query.after)!;
    const anchor = anchorScenario.query.after!;
    await client.person.update({ where: { id: anchor }, data: { isArchived: false } });
    const restoredAnchorPage = await getFamilyArchivePage(anchorScenario.slug, anchorScenario.query);
    assert.equal(createHash("sha256").update(JSON.stringify(restoredAnchorPage)).digest("hex"), expected.get(anchorScenario.name));
    await client.person.update({ where: { id: anchor }, data: { isArchived: true } });
    // @updatedAt changed in the explicit correctness exercise; baseline starts afterwards.
    originalFingerprint = await fingerprint();

    stage = "isolated HTTP server";
    await lstat(path.join(project, ".next/BUILD_ID"));
    httpRoot = await mkdtemp(path.join(scratchParent, "rodovo-archive-http-"));
    for (const name of [".next", "node_modules"]) await symlink(path.join(project, name), path.join(httpRoot, name), process.platform === "win32" ? "junction" : "dir");
    await mkdir(path.join(httpRoot, "app"));
    await writeFile(path.join(httpRoot, "package.json"), JSON.stringify({ private: true, name: "isolated-archive-benchmark", version: "0.0.0" }));
    const httpPort = await freePort();
    const base = `http://127.0.0.1:${httpPort}`;
    const serverEnv: NodeJS.ProcessEnv = { ...process.env, ...env, NODE_ENV: "production", REDIS_URL: "", NEXT_TELEMETRY_DISABLED: "1", NODE_OPTIONS: "" };
    const child = spawn(process.execPath, [path.join(project, "node_modules/next/dist/bin/next"), "start", httpRoot, "--hostname", "127.0.0.1", "--port", String(httpPort)], {
      cwd: httpRoot, env: serverEnv, shell: false, windowsHide: true, stdio: "ignore",
    });
    httpChild = child;
    let spawnFailed = false;
    child.on("error", () => { spawnFailed = true; });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.ok(!spawnFailed && child.exitCode === null);
      try {
        const response = await fetch(`${base}/api/health/live`, { signal: AbortSignal.timeout(1000) });
        ready = response.status === 200; await response.body?.cancel();
        if (ready) break;
      } catch { /* Only the isolated loopback server is polled. */ }
      await delay(200);
    }
    assert.equal(ready, true);
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST", headers: { origin: base }, body: new URLSearchParams({ email, password }), redirect: "manual", signal: AbortSignal.timeout(10000),
    });
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.equal(login.status, 303); assert.ok(cookie); assert.ok(cookie.startsWith("rodovo_session="));
    await login.body?.cancel();
    const httpRead = async (scenario: Scenario) => {
      const suffix = new URLSearchParams(scenario.query).toString();
      const start = performance.now();
      const response = await fetch(`${base}/family/${scenario.slug}/archive${suffix ? `?${suffix}` : ""}`, {
        headers: { cookie }, redirect: "manual", signal: AbortSignal.timeout(30000),
      });
      const ttfb = performance.now() - start;
      const body = await response.text();
      const elapsed = performance.now() - start;
      assert.equal(response.status, 200);
      assert.equal((body.match(/<article class="archive-card"/g) ?? []).length, 24);
      assert.ok(body.includes(`Synthetic ${scenario.slug}`));
      return { ms: elapsed, ttfb, bytes: Buffer.byteLength(body) };
    };

    const phases: Phase[] = [];
    for (let phaseNumber = 0; phaseNumber < 4; phaseNumber++) {
      const indexed = phaseNumber % 2 === 1;
      stage = `phase ${phaseNumber + 1}`;
      await assertOwner();
      let indexBuildMs: number | undefined;
      if (indexed) {
        const start = performance.now();
        await client.$executeRawUnsafe(migrationSql);
        indexBuildMs = performance.now() - start;
        const state = await indexState(); assert.equal(state.length, 1); assert.ok(state[0].valid && state[0].ready);
      } else {
        await client.$executeRawUnsafe('DROP INDEX "Person_familyId_isArchived_id_idx"');
        assert.deepEqual(await indexState(), []);
      }
      // Identical statistics maintenance; planner switches are never forced.
      await client.$executeRawUnsafe('ANALYZE "Person"');
      const phase: Phase = { name: `${indexed ? "B" : "A"}${Math.floor(phaseNumber / 2) + 1}`, indexed, indexBuildMs, scenarios: [] };
      for (const scenario of scenarios) {
        for (let warm = 0; warm < 3; warm++) { await getFamilyArchivePage(scenario.slug, scenario.query); await httpRead(scenario); }
        phase.scenarios.push({ name: scenario.name, loaderMs: [], httpMs: [], ttfbMs: [], jsonBytes: 0, httpBytes: 0, resultHash: "", plans: [] });
      }
      for (let round = 0; round < LOADER_ROUNDS; round++) {
        for (let offset = 0; offset < scenarios.length; offset++) {
          const index = (offset + round + phaseNumber) % scenarios.length;
          const scenario = scenarios[index]; const result = phase.scenarios[index];
          const start = performance.now();
          const value = await getFamilyArchivePage(scenario.slug, scenario.query);
          const json = JSON.stringify(value);
          result.loaderMs.push(performance.now() - start);
          result.resultHash = createHash("sha256").update(json).digest("hex");
          assert.equal(result.resultHash, expected.get(scenario.name));
          result.jsonBytes = Buffer.byteLength(json);
        }
      }
      for (let round = 0; round < HTTP_ROUNDS; round++) {
        for (let offset = 0; offset < scenarios.length; offset++) {
          const index = (offset + round + phaseNumber) % scenarios.length;
          const value = await httpRead(scenarios[index]);
          phase.scenarios[index].httpMs.push(value.ms);
          phase.scenarios[index].ttfbMs.push(value.ttfb);
          phase.scenarios[index].httpBytes = value.bytes;
        }
      }
      for (let index = 0; index < scenarios.length; index++) {
        capture = [];
        await getFamilyArchivePage(scenarios[index].slug, scenarios[index].query);
        const queries = capture; capture = null;
        for (const query of queries) {
          assert.match(query.query, /^SELECT\b/i);
          const parameters: unknown[] = JSON.parse(query.params);
          const plan = await client.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.query}`, ...parameters);
          phase.scenarios[index].plans.push({ sql: query.query, parameters, explain: plan });
        }
      }
      assert.deepEqual(await fingerprint(), originalFingerprint);
      phases.push(phase);
      await mkdir(path.join(project, "tmp"), { recursive: true });
      await writeFile(path.join(project, "tmp", `archive-index-${runId}-${phase.name}.json`), JSON.stringify(phase, null, 2) + "\n", { flag: "wx" });
      console.log(`Phase ${phase.name} complete: ${scenarios.length} scenarios, ${LOADER_ROUNDS} reader + ${HTTP_ROUNDS} HTTP samples each; result/data checks passed.`);
    }
    stage = "report";
    const server = await client.$queryRaw<Record<string, unknown>[]>`
      SELECT version() AS version, current_setting('shared_buffers') AS shared_buffers,
      current_setting('work_mem') AS work_mem, current_setting('jit') AS jit,
      current_setting('max_parallel_workers_per_gather') AS parallel_workers,
      (SELECT datcollate FROM pg_database WHERE datname = current_database()) AS collation`;
    const finalIndex = (await indexState())[0];
    assert.ok(finalIndex.valid && finalIndex.ready);
    const aggregate = scenarios.map((scenario) => {
      const collect = (indexed: boolean, metric: "loaderMs" | "httpMs" | "ttfbMs") => phases.filter((phase) => phase.indexed === indexed).flatMap((phase) => phase.scenarios.find((result) => result.name === scenario.name)![metric]);
      return { name: scenario.name, withoutIndex: { loader: summary(collect(false, "loaderMs")), http: summary(collect(false, "httpMs")), ttfb: summary(collect(false, "ttfbMs")) },
        withIndex: { loader: summary(collect(true, "loaderMs")), http: summary(collect(true, "httpMs")), ttfb: summary(collect(true, "ttfbMs")) } };
    });
    const report = {
      date: "2026-10-25", migration: MIGRATION, migrationSha256: migrationHash,
      scope: "Disposable native Windows PostgreSQL; synthetic data; warm-cache sequential A/B/A/B. Reader includes JSON serialization; HTTP includes normal authentication, SSR and full HTML download, not browser rendering.",
      environment: { node: process.version, platform: process.platform, cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), server: server[0] },
      fixture: { families: families.length, people: 421000, targets, idDistribution: "MD5(family:sequence), interleaved globally", biographyBytes: 512 },
      validation: { equalResults: true, equalPersonRows: true, deletedAnchorCursor: true, indexValid: finalIndex.valid, indexReady: finalIndex.ready },
      index: { bytes: Number(finalIndex.bytes), definition: finalIndex.definition },
      aggregate, phases,
    };
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    console.log("Archive index benchmark PASS. Synthetic measurements written to docs/benchmarks/archive-index-2026-10-25.json.");
  } finally {
    if (httpChild) await stop(httpChild);
    await client.$disconnect();
    if (previousPrisma === undefined) delete globalPrisma.prisma; else globalPrisma.prisma = previousPrisma;
    if (httpRoot) {
      const resolved = await realpath(httpRoot);
      assert.equal(path.dirname(resolved), scratchParent); assert.ok(path.basename(resolved).startsWith("rodovo-archive-http-"));
      for (const name of [".next", "node_modules"]) {
        const link = path.join(resolved, name);
        assert.ok((await lstat(link)).isSymbolicLink()); await rm(link);
      }
      await rm(resolved, { recursive: true, force: true });
    }
  }
}

void main().catch(() => {
  // Do not print driver errors, URLs, login cookies or server output.
  console.error(`Archive index benchmark failed during ${stage}. No private diagnostics printed.`);
  process.exitCode = 1;
});
