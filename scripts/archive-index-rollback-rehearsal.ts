import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { getArchiveBenchmarkEnvironment } from "./archive-index-benchmark-environment";

const CREATE = "20261025000000_archive_pagination_index";
const DROP = "20261025010000_rollback_archive_pagination_index";
const INDEX = "Person_familyId_isArchived_id_idx";
const hash = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

async function main() {
  assert.equal(process.argv.length, 2, "No CLI arguments accepted.");
  const profile = process.env.INDEX_REHEARSAL_PROFILE;
  assert.ok(profile === undefined || profile === "pg18-release", "Unknown rehearsal profile.");
  const pg18Release = profile === "pg18-release";
  // Reuse the fail-closed loopback/non-default-port guard BEFORE importing Prisma.
  const env = getArchiveBenchmarkEnvironment(process.env);
  const project = process.cwd();
  const root = process.env.INDEX_REHEARSAL_ROOT;
  assert.ok(root && path.isAbsolute(root));
  const relative = path.relative(path.join(project, "tmp"), root);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal((await readFile(path.join(root, ".lab-owner"), "utf8")).trim(), env.ARCHIVE_BENCHMARK_TOKEN);
  const reportPath = path.join(project, pg18Release
    ? "docs/benchmarks/archive-index-pg18-release-2026-10-25.json"
    : "docs/benchmarks/archive-index-rollback-2026-10-25.json");
  await assert.rejects(stat(reportPath), { code: "ENOENT" });
  Object.assign(process.env, { DATABASE_URL: env.DATABASE_URL, TEST_DATABASE_URL: env.TEST_DATABASE_URL, NODE_ENV: "test" });
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  const events: object[] = [];
  const releaseRoot = path.join(project, "docs/operations/archive-index-release-pg18");
  const bundle = pg18Release ? path.join(releaseRoot, "rollback") : path.join(project, "docs/operations/archive-index-rollback");
  const applyBundle = pg18Release ? path.join(releaseRoot, "apply") : bundle;
  const cli = path.join(project, "node_modules/prisma/build/index.js");
  const node = process.execPath;
  const baseUrl = env.DATABASE_URL!;
  const timedUrl = (lock: string, statement: string, name: string) => {
    const url = new URL(baseUrl);
    url.searchParams.set("options", `-c lock_timeout=${lock} -c statement_timeout=${statement} -c application_name=${name}`);
    return url.toString();
  };
  async function owner() {
    const rows = await db.$queryRawUnsafe<{ name: string; host: string; port: number; marker: string }[]>(
      "SELECT current_database() AS name, host(inet_server_addr()) AS host, inet_server_port() AS port, shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
    assert.equal(rows[0].name, "rodovo_ci_test");
    assert.equal(rows[0].host, "127.0.0.1");
    assert.equal(rows[0].port, Number(new URL(baseUrl).port));
    assert.equal(rows[0].marker, `rodovo-archive-index-test:${env.ARCHIVE_BENCHMARK_TOKEN}`);
  }
  async function run(args: string[], schema: string, url = timedUrl("3s", "60s", "index_rehearsal"), expected = 0) {
    await owner();
    const start = performance.now();
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(node, [cli, ...args, ...(args[1] === "diff" ? [] : ["--schema", schema])], {
        cwd: root, env: { ...env, NODE_ENV: "test", DATABASE_URL: url, TEST_DATABASE_URL: baseUrl, PGOPTIONS: "", PRISMA_HIDE_UPDATE_MESSAGE: "1" },
        windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (data) => { output += data; });
      child.stderr.on("data", (data) => { output += data; });
      // Outer watchdog bounds an unexpected driver regression. The blocker also has a transaction timeout.
      const timer = setTimeout(() => { child.kill(); reject(new Error("CLI watchdog exceeded 30s; inspect local server before retry.")); }, 30_000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (code) => { clearTimeout(timer); resolve({ code, output }); });
    });
    assert.ok(!result.output.includes("Environment variables loaded from"), "Prisma must not load any .env in the isolated rehearsal.");
    assert.equal(result.code === 0, expected === 0, result.output.replaceAll(url, "[test database]"));
    return { ...result, elapsedMs: performance.now() - start };
  }
  async function state() {
    return db.$queryRawUnsafe<{ valid: boolean; ready: boolean; definition: string }[]>(
      `SELECT indisvalid AS valid, indisready AS ready, pg_get_indexdef(indexrelid) AS definition FROM pg_index WHERE indexrelid=to_regclass('public."${INDEX}"')`);
  }
  async function fingerprint() {
    return db.$queryRawUnsafe("SELECT count(*)::text AS count, sum(hashtextextended(row_to_json(p)::text,0)::numeric)::text AS checksum FROM \"Person\" p");
  }
  async function history(schema: string, expected: number) {
    const rows = await db.$queryRawUnsafe<{ migration_name: string; checksum: string; finished: boolean; rolled: boolean }[]>(
      "SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled FROM _prisma_migrations ORDER BY started_at");
    const active = rows.filter((row) => !row.rolled);
    assert.equal(active.length, expected);
    for (const row of active) {
      assert.ok(row.finished);
      assert.equal(row.checksum, hash(await readFile(path.join(path.dirname(schema), "migrations", row.migration_name, "migration.sql"))));
    }
    return rows.map(({ migration_name, checksum, finished, rolled }) => ({ migration_name, checksum, finished, rolled }));
  }
  async function blocked(schema: string, mode: "ROW EXCLUSIVE" | "ACCESS SHARE", lock: string, statement: string, errorCode: string, name: string) {
    let release!: () => void;
    let acquired!: () => void;
    const ready = new Promise<void>((resolve) => { acquired = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const holder = db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`LOCK TABLE public."Person" IN ${mode} MODE`);
      acquired();
      await gate;
    }, { timeout: 20_000 });
    // Avoid an unhandled rejection if the lock-holder fails before acquiring its lock.
    const holderFailure = holder.then(() => { throw new Error("Blocker ended before ready"); });
    try {
      await Promise.race([ready, holderFailure]);
      const result = await run(["migrate", "deploy"], schema, timedUrl(lock, statement, name), 1);
      assert.ok(result.output.includes(errorCode), result.output);
      events.push({ scenario: name, sqlstate: errorCode, elapsedMs: result.elapsedMs, indexPresent: (await state()).length === 1 });
      console.log(`${name}: ${errorCode} in ${Math.round(result.elapsedMs)}ms`);
    } finally { release(); await holder; }
  }
  try {
    await owner();
    const serverVersion = await db.$queryRawUnsafe<{ version: string; version_number: string }[]>(
      "SELECT version() AS version, current_setting('server_version_num') AS version_number");
    if (pg18Release) assert.equal(serverVersion[0].version_number, "180006", "This release must be rehearsed on PostgreSQL 18.6.");
    assert.equal((await db.$queryRawUnsafe<{ count: bigint }[]>("SELECT count(*) AS count FROM pg_tables WHERE schemaname='public'"))[0].count, BigInt(0), "Requires a fresh empty owned database.");
    let baselineChecksums: { migration: string; checksum: string }[] | undefined;
    if (pg18Release) {
      const baseline = JSON.parse(await readFile(path.join(releaseRoot, "baseline-checksums.json"), "utf8")) as { migrations: { migration: string; checksum: string }[] };
      assert.equal(baseline.migrations.length, 8);
      assert.equal(new Set(baseline.migrations.map((row) => row.migration)).size, 8);
      baselineChecksums = baseline.migrations;
      for (const source of [applyBundle, bundle]) {
        for (const row of baselineChecksums) {
          assert.equal(hash(await readFile(path.join(source, "migrations", row.migration, "migration.sql"))), row.checksum,
            "Release SQL bytes must match the recorded production baseline.");
        }
      }
    }
    const artifacts = path.join(root, "artifacts");
    // Stop Prisma's package-root discovery here; never load the workspace .env.
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "isolated-index-rollback-lab", private: true }), { flag: "wx" });
    await mkdir(artifacts);
    const versions: Record<string, string> = {};
    const artifactChecksums: Record<string, { schema: string; migrations: { migration: string; checksum: string }[] }> = {};
    for (const [name, limit] of [["baseline", 8], ["create", 9], ["rollback", 10]] as const) {
      const source = pg18Release && name === "create" ? applyBundle : bundle;
      const dest = path.join(artifacts, name);
      await mkdir(path.join(dest, "migrations"), { recursive: true });
      await cp(path.join(source, "schema.prisma"), path.join(dest, "schema.prisma"));
      await cp(path.join(source, "migrations/migration_lock.toml"), path.join(dest, "migrations/migration_lock.toml"));
      const dirs = (await readdir(path.join(source, "migrations"), { withFileTypes: true })).filter((item) => item.isDirectory()).map((item) => item.name).sort();
      assert.equal(dirs.length, pg18Release && name === "create" ? 9 : 10);
      if (pg18Release) {
        const expected = [...baselineChecksums!.map((row) => row.migration), CREATE, ...(name === "create" ? [] : [DROP])].sort();
        assert.deepEqual(dirs, expected, "Release must contain only its reviewed migration sequence.");
        assert.equal(hash(await readFile(path.join(source, "migrations", CREATE, "migration.sql"))), "a84eb87e424bea2cc6d9a55e896c7b5c5bec6d475dc905cbb9a6121c4e9ec97d");
      }
      for (const dir of dirs.slice(0, limit)) await cp(path.join(source, "migrations", dir), path.join(dest, "migrations", dir), { recursive: true });
      if (!pg18Release && name === "create") await cp(path.join(project, "prisma/schema.prisma"), path.join(dest, "schema.prisma"));
      versions[name] = path.join(dest, "schema.prisma");
      artifactChecksums[name] = { schema: hash(await readFile(versions[name])), migrations: [] };
      for (const migration of dirs.slice(0, limit)) {
        artifactChecksums[name].migrations.push({ migration, checksum: hash(await readFile(path.join(dest, "migrations", migration, "migration.sql"))) });
      }
    }
    const createSql = await readFile(path.join(bundle, "migrations", CREATE, "migration.sql"));
    assert.equal(hash(createSql), "a84eb87e424bea2cc6d9a55e896c7b5c5bec6d475dc905cbb9a6121c4e9ec97d");
    await run(["migrate", "deploy"], versions.baseline);
    await history(versions.baseline, 8);
    await db.family.create({ data: { id: "rollback-synthetic", slug: "rollback-synthetic", title: "Synthetic", surname: "Synthetic", description: "Synthetic", region: "Synthetic", coverQuote: "" } });
    await db.$executeRawUnsafe(`INSERT INTO "Person" ("id","familyId","firstName","lastName","gender","birthDate","birthPlace","status","isArchived","biography","updatedAt") SELECT md5(s::text),'rollback-synthetic','Synthetic','Record ' || s::text,'male'::"Gender",'1900','Synthetic','living'::"PersonStatus",s%2=0,repeat(md5(s::text),16),CURRENT_TIMESTAMP FROM generate_series(1,421000) s`);
    const original = await fingerprint();
    assert.equal((await state()).length, 0);
    await blocked(versions.create, "ROW EXCLUSIVE", "3s", "60s", "55P03", "create_lock_timeout");
    assert.equal((await state()).length, 0);
    await run(["migrate", "resolve", "--rolled-back", CREATE], versions.create);
    await blocked(versions.create, "ROW EXCLUSIVE", "3s", "1s", "57014", "create_statement_timeout");
    assert.equal((await state()).length, 0);
    await run(["migrate", "resolve", "--rolled-back", CREATE], versions.create);
    let result = await run(["migrate", "deploy"], versions.create);
    const created = await state();
    assert.equal(created.length, 1); assert.ok(created[0].valid && created[0].ready);
    events.push({ scenario: "create_success", elapsedMs: result.elapsedMs, index: created[0] });
    await history(versions.create, 9);
    if (pg18Release) {
      await run(["migrate", "status"], versions.create);
      await run(["migrate", "diff", "--from-url", timedUrl("3s", "60s", "index_create_diff"), "--to-schema-datamodel", versions.create, "--exit-code"], versions.create);
      result = await run(["migrate", "deploy"], versions.create);
      assert.match(result.output, /No pending migrations/);
      events.push({ scenario: "create_status_diff_noop", passed: true });
    }
    await blocked(versions.rollback, "ACCESS SHARE", "3s", "60s", "55P03", "drop_lock_timeout");
    assert.equal((await state()).length, 1);
    await run(["migrate", "resolve", "--rolled-back", DROP], versions.rollback);
    await blocked(versions.rollback, "ACCESS SHARE", "3s", "1s", "57014", "drop_statement_timeout");
    assert.equal((await state()).length, 1);
    await run(["migrate", "resolve", "--rolled-back", DROP], versions.rollback);
    result = await run(["migrate", "deploy"], versions.rollback);
    assert.equal((await state()).length, 0);
    assert.deepEqual(await fingerprint(), original);
    events.push({ scenario: "rollback_success", elapsedMs: result.elapsedMs, fingerprint: original });
    const finalHistory = await history(versions.rollback, 10);
    await run(["migrate", "status"], versions.rollback);
    await run(["migrate", "diff", "--from-url", timedUrl("3s", "60s", "index_diff"), "--to-schema-datamodel", versions.rollback, "--exit-code"], versions.rollback);
    result = await run(["migrate", "deploy"], versions.rollback);
    assert.match(result.output, /No pending migrations/);
    // Prove exact 3s/60s settings inside the migration engine, plus execution-time cancellation.
    const probe = path.join(artifacts, "probe");
    await cp(path.dirname(versions.rollback), probe, { recursive: true });
    const probeDir = path.join(probe, "migrations/20261025020000_timeout_probe");
    await mkdir(probeDir);
    await writeFile(path.join(probeDir, "migration.sql"), `DO $$ BEGIN IF current_setting('lock_timeout')::interval <> interval '3 seconds' OR current_setting('statement_timeout')::interval <> interval '60 seconds' THEN RAISE EXCEPTION 'wrong migration session timeouts'; END IF; END $$;`);
    await run(["migrate", "deploy"], path.join(probe, "schema.prisma"));
    events.push({ scenario: "migration_session_settings", lockTimeout: "3s", statementTimeout: "60s", verifiedInsideMigration: true });
    const sleepDir = path.join(probe, "migrations/20261025030000_execution_timeout_probe");
    await mkdir(sleepDir);
    await writeFile(path.join(sleepDir, "migration.sql"), "SELECT pg_sleep(5);");
    result = await run(["migrate", "deploy"], path.join(probe, "schema.prisma"), timedUrl("3s", "1s", "execution_timeout_probe"), 1);
    assert.match(result.output, /57014/);
    events.push({ scenario: "execution_statement_timeout", sqlstate: "57014", elapsedMs: result.elapsedMs });
    await run(["migrate", "resolve", "--rolled-back", "20261025030000_execution_timeout_probe"], path.join(probe, "schema.prisma"));
    assert.deepEqual(await fingerprint(), original);
    const report = { date: new Date().toISOString(), profile: profile ?? "legacy", server: serverVersion, prisma: JSON.parse(await readFile(path.join(project, "node_modules/prisma/package.json"), "utf8")).version, syntheticPeople: 421000, baselineChecksums, artifactChecksums, createSha256: hash(createSql), rollbackSha256: hash(await readFile(path.join(bundle, "migrations", DROP, "migration.sql"))), events, finalHistory, finalIndexAbsent: true, personFingerprintUnchanged: true, note: "Probe migrations exist only in disposable lab; finalHistory captured before probes. No production connection." };
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    console.log("Rollback rehearsal passed; report written.");
  } finally { await db.$disconnect(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Rehearsal failed"); process.exitCode = 1; });
