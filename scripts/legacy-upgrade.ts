import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getCiDatabaseEnvironment } from "./ci-database-environment";
import { assertMigrationHistory, type MigrationHistoryRow } from "./ci-migration-history";
import { hashSessionToken, readValidSession } from "../lib/session-reader";

const tables = ["User", "Session", "Family", "FamilyMembership", "DigitizationTask", "Person", "Relationship", "Story", "TimelineEvent", "MediaAsset", "AuditLog"] as const;
const legacyNames = ["20260722115807_init", "20260802000000_member_audit_actions"];
let phase = "guard";
let cleanupCode = "";

async function main() {
  assert.equal(process.argv.length, 2);
  const env: NodeJS.ProcessEnv = { ...getCiDatabaseEnvironment(process.env), NODE_ENV: "test" };
  const project = process.cwd();
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: env.DATABASE_URL, log: [] });
  let temporary: string | undefined;
  let successMessage = "";
  try {
    phase = "empty-database check";
    const objects = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'`;
    assert.equal(objects[0].count, BigInt(0), "Requires a fresh empty public schema; never resets existing data.");
    temporary = await mkdtemp(path.join(os.tmpdir(), "rodovo-legacy-upgrade-"));
    const schema = path.join(temporary, "schema.prisma");
    await copyFile(path.join(project, "prisma/schema.prisma"), schema);
    const destination = path.join(temporary, "migrations");
    await mkdir(destination);
    await copyFile(path.join(project, "prisma/migrations/migration_lock.toml"), path.join(destination, "migration_lock.toml"));
    const files = new Map<string, string>();
    const source = path.join(project, "prisma/migrations");
    const names = (await readdir(source, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    assert.deepEqual(names.slice(0, 2), legacyNames);
    for (const name of names) {
      files.set(name, createHash("sha256").update(await readFile(path.join(source, name, "migration.sql"))).digest("hex"));
    }
    const copyMigration = async (name: string) => {
      await mkdir(path.join(destination, name));
      await copyFile(path.join(source, name, "migration.sql"), path.join(destination, name, "migration.sql"));
    };
    const cli = (...args: string[]) => {
      const result = spawnSync(process.execPath, [path.join(project, "node_modules/prisma/build/index.js"), ...args], {
        cwd: temporary, env, encoding: "utf8", shell: false, timeout: 120000, windowsHide: true,
      });
      // Never echo driver/CLI output, which can contain connection details.
      assert.ifError(result.error);
      assert.equal(result.status, 0, "Prisma command failed");
    };
    phase = "legacy deployment";
    for (const name of legacyNames) await copyMigration(name);
    cli("migrate", "deploy", "--schema", schema);
    assertMigrationHistory(new Map(legacyNames.map((name) => [name, files.get(name)!])), await db.$queryRaw<MigrationHistoryRow[]>`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`);
    phase = "synthetic fixtures";
    const sql = await readFile(path.join(project, "scripts/legacy-upgrade-fixture.sql"), "utf8");
    for (const statement of sql.split(";").map((value) => value.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
    await db.$executeRaw`INSERT INTO "Session" (id, "tokenHash", "userId", "expiresAt", "updatedAt") VALUES ('legacy-session', ${hashSessionToken("synthetic-legacy-token")}, 'legacy-user', '2099-01-01', '2026-01-02')`;
    await db.$executeRaw`INSERT INTO "Session" (id, "tokenHash", "userId", "expiresAt", "updatedAt") VALUES ('legacy-expired-session', ${hashSessionToken("synthetic-expired-token")}, 'legacy-user', '2000-01-01', '2026-01-02')`;
    const snapshot = async () => {
      const result: Record<string, Record<string, unknown>[]> = {};
      // Identifiers come exclusively from the fixed table allowlist above.
      for (const table of tables) result[table] = (await db.$queryRawUnsafe<{ row: Record<string, unknown> }[]>(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY id`)).map(({ row }) => row);
      return result;
    };
    const before = await snapshot();
    phase = "full deployment";
    for (const name of names.slice(2)) await copyMigration(name);
    cli("migrate", "deploy", "--schema", schema);
    phase = "data preservation";
    const after = await snapshot();
    for (const table of tables) {
      assert.equal(after[table].length, before[table].length);
      before[table].forEach((row, index) => {
        for (const key of Object.keys(row)) assert.deepEqual(after[table][index][key], row[key], `${table}.${key} preserved`);
      });
    }
    const account = await db.user.findUniqueOrThrow({ where: { id: "legacy-user" } });
    assert.equal(account.legacyAccount, true);
    assert.equal(account.emailVerifiedAt, null);
    assert.equal(account.sessionVersion, 0);
    assert.ok(await readValidSession("synthetic-legacy-token", (tokenHash) => db.session.findUnique({ where: { tokenHash }, include: { user: true } })));
    assert.equal(await readValidSession("synthetic-expired-token", (tokenHash) => db.session.findUnique({ where: { tokenHash }, include: { user: true } })), null);
    for (const person of await db.person.findMany()) assert.equal(person.version, 0);
    for (const edge of await db.relationship.findMany()) {
      assert.equal(edge.origin, "manual"); assert.equal(edge.sourcePersonId, null); assert.equal(edge.version, 0);
    }
    for (const story of await db.story.findMany()) { assert.equal(story.version, 0); assert.equal(story.deletedAt, null); }
    for (const media of await db.mediaAsset.findMany()) {
      assert.equal(media.state, "ready"); assert.equal(media.checksum, null); assert.equal(media.cleanupAttempts, 0);
      for (const key of ["lastErrorCode", "cleanupAfter", "cleanupLeaseUntil", "cleanupLeaseToken"] as const) assert.equal(media[key], null);
    }
    assert.deepEqual((await db.timelineEvent.findMany({ orderBy: { id: "asc" }, select: { id: true, kind: true } })), [
      { id: "timeline-added", kind: "custom" }, { id: "timeline-birth", kind: "birth" },
      { id: "timeline-custom", kind: "custom" }, { id: "timeline-unmatched", kind: "custom" },
    ]);
    assert.equal(await db.parentSuppression.count(), 0);
    assert.equal(await db.authToken.count(), 0);
    assert.equal(await db.familyInvitation.count(), 0);
    const fresh = await db.user.create({ data: { id: "new-user", firstName: "Новый", lastName: "Тест", email: "new@example.invalid", passwordHash: "synthetic-unusable-hash" } });
    assert.equal(fresh.legacyAccount, false);
    phase = "history and schema";
    assertMigrationHistory(files, await db.$queryRaw<MigrationHistoryRow[]>`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`);
    cli("migrate", "status", "--schema", schema);
    cli("migrate", "diff", "--from-schema-datasource", schema, "--to-schema-datamodel", schema, "--exit-code");
    phase = "idempotent deployment";
    const stable = await snapshot();
    cli("migrate", "deploy", "--schema", schema);
    assert.deepEqual(await snapshot(), stable);
    assertMigrationHistory(files, await db.$queryRaw<MigrationHistoryRow[]>`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`);
    successMessage = `PASS legacy upgrade: ${legacyNames.length} -> ${names.length} migrations; ${tables.length} legacy tables preserved; defaults, session, timeline, history, drift and repeat deployment verified.`;
  } finally {
    const operationPhase = phase;
    phase = "disconnect";
    await db.$disconnect();
    if (temporary) {
      phase = "temporary cleanup";
      const resolved = path.resolve(temporary);
      assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
      assert.ok(path.basename(resolved).startsWith("rodovo-legacy-upgrade-"));
      try {
        // Windows scanners can briefly retain a handle after the CLI exits.
        await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (typeof code === "string" && ["EPERM", "EACCES", "EBUSY", "ENOTEMPTY", "EMFILE", "ENFILE"].includes(code)) cleanupCode = ` ${code}`;
        throw error;
      }
    }
    phase = operationPhase;
  }
  console.log(successMessage);
}

main().catch(() => { console.error(`Legacy upgrade refused or failed (${phase}${cleanupCode}).`); process.exitCode = 1; });
