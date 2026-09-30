import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { createBackupPackage, restoreBackupPackage, verifyBackupPackage, type BackupMetadata } from "../lib/backup-manifest";
import { hashSessionToken, readValidSession } from "../lib/session-reader";
import { getRecoveryEnvironment } from "./recovery-drill-environment";
import { assertMigrationHistory, type MigrationHistoryRow } from "./ci-migration-history";
import { runRecoveryHttpSmoke } from "./recovery-http-smoke";

const tables = ["User", "Session", "AuthToken", "Family", "FamilyMembership", "FamilyInvitation", "DigitizationTask", "Person", "Relationship", "ParentSuppression", "Story", "TimelineEvent", "MediaAsset", "AuditLog", "_prisma_migrations"] as const;
const email = "recovery@example.invalid";
const password = "Synthetic-recovery-2026!";
let phase = "guard";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function snapshot(db: PrismaClient) {
  const result: Record<string, unknown[]> = {};
  for (const table of tables) {
    // Table identifiers are fixed above, never supplied by a caller.
    result[table] = (await db.$queryRawUnsafe<{ row: unknown }[]>(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY id`)).map(({ row }) => row);
  }
  return result;
}

async function main() {
  assert.equal(process.argv.length, 2);
  const config = getRecoveryEnvironment(process.env);
  const command = (executable: string, args: string[], env?: NodeJS.ProcessEnv, cwd?: string) => {
    const result = spawnSync(executable, args, { env, cwd, encoding: "utf8", shell: false, windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, "Child operation failed");
    return result.stdout;
  };
  phase = "container identity";
  const inspected = JSON.parse(command("docker", ["inspect", "--format", "{{json .}}", config.container]));
  assert.equal(inspected.Config.Labels["rodovo.task"], "recovery-drill");
  assert.equal(inspected.State.Running, true);
  assert.match(inspected.Id, /^[a-f0-9]{64}$/);
  const containerId = inspected.Id as string;
  assert.deepEqual(inspected.NetworkSettings.Ports["5432/tcp"], [{ HostIp: "127.0.0.1", HostPort: config.port }]);
  assert.match(command("docker", ["exec", containerId, "pg_dump", "--version"]), /PostgreSQL\) 16\./);
  const docker = (...args: string[]) => command("docker", ["exec", containerId, ...args]);
  const { PrismaClient } = await import("@prisma/client");
  const source = new PrismaClient({ datasourceUrl: config.source, log: [] });
  const target = new PrismaClient({ datasourceUrl: config.target, log: [] });
  let temporary: string | undefined;
  let report: object | undefined;
  try {
    phase = "empty databases";
    for (const db of [source, target]) {
      const rows = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'`;
      assert.equal(rows[0].count, BigInt(0));
    }
    temporary = await mkdtemp(path.join(os.tmpdir(), "rodovo-recovery-drill-"));
    const storage = path.join(temporary, "source-storage");
    const uploads = path.join(storage, "uploads", "synthetic-recovery", "recovery-child");
    await mkdir(uploads, { recursive: true });
    phase = "source schema";
    command(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", path.resolve("prisma/schema.prisma")], { ...process.env, NODE_ENV: "test", DATABASE_URL: config.source }, temporary);
    const migrationFiles = new Map<string, string>();
    for (const entry of await readdir("prisma/migrations", { withFileTypes: true })) {
      if (entry.isDirectory()) migrationFiles.set(entry.name, digest(await readFile(path.join("prisma/migrations", entry.name, "migration.sql"))));
    }
    phase = "synthetic fixtures";
    const salt = randomBytes(16).toString("hex");
    await source.user.create({ data: { id: "recovery-user", firstName: "Тест", lastName: "Восстановление", email, passwordHash: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`, emailVerifiedAt: new Date() } });
    await source.session.create({ data: { id: "recovery-session", userId: "recovery-user", tokenHash: hashSessionToken("synthetic-recovery-session"), expiresAt: new Date("2099-01-01") } });
    await source.authToken.create({ data: { id: "recovery-token", userId: "recovery-user", email, tokenHash: hashSessionToken("synthetic-recovery-reset"), purpose: "password_reset", sessionVersion: 0, expiresAt: new Date("2000-01-01"), consumedAt: new Date("2000-01-01") } });
    await source.family.create({ data: { id: "recovery-family", slug: "synthetic-recovery", title: "Синтетическое восстановление", surname: "Тест", description: "Учебный архив", region: "Тест", coverQuote: "Тест", peopleCount: 2, photosCount: 1, audioCount: 1, storiesCount: 1, contributorsCount: 1 } });
    await source.familyMembership.create({ data: { id: "recovery-membership", familyId: "recovery-family", userId: "recovery-user", name: "Тест", role: "owner" } });
    await source.familyInvitation.create({ data: { id: "recovery-invitation", familyId: "recovery-family", invitedById: "recovery-user", email: "invited@example.invalid", role: "guest", tokenHash: hashSessionToken("synthetic-recovery-invitation"), expiresAt: new Date("2099-01-01") } });
    await source.digitizationTask.create({ data: { id: "recovery-task", familyId: "recovery-family", title: "Тест", owner: "Тест", status: "planned" } });
    for (const [id, firstName, gender, archived] of [["recovery-father", "Отец", "male", true], ["recovery-mother", "Мать", "female", false], ["recovery-child", "Ребёнок", "female", false]] as const) {
      await source.person.create({ data: { id, familyId: "recovery-family", firstName, lastName: "Тест", gender, birthDate: id === "recovery-child" ? "1980" : "1950", birthPlace: "Тест", status: "living", isArchived: archived, biography: "Синтетическая биография", photosCount: id === "recovery-child" ? 1 : 0, audioCount: id === "recovery-child" ? 1 : 0 } });
    }
    await source.relationship.createMany({ data: [
      { id: "recovery-spouse", familyId: "recovery-family", fromPersonId: "recovery-father", toPersonId: "recovery-mother", type: "spouse" },
      { id: "recovery-parent", familyId: "recovery-family", fromPersonId: "recovery-mother", toPersonId: "recovery-child", type: "parent" },
    ] });
    await source.parentSuppression.create({ data: { id: "recovery-suppression", familyId: "recovery-family", fromPersonId: "recovery-father", toPersonId: "recovery-child" } });
    for (const deleted of [false, true]) await source.story.create({ data: { id: deleted ? "recovery-deleted-story" : "recovery-story", personId: "recovery-child", title: "История", body: "Синтетическая история", deletedAt: deleted ? new Date("2026-01-01") : null } });
    await source.timelineEvent.create({ data: { id: "recovery-timeline", personId: "recovery-child", label: "1980 — рождение", kind: "birth", order: 0 } });
    await source.auditLog.create({ data: { id: "recovery-audit", familyId: "recovery-family", action: "person_created", actorName: "Тест", message: "Синтетическая запись" } });
    const photoBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=", "base64");
    const audioBytes = Buffer.alloc(844, 128);
    audioBytes.write("RIFF", 0); audioBytes.writeUInt32LE(836, 4); audioBytes.write("WAVEfmt ", 8); audioBytes.writeUInt32LE(16, 16);
    audioBytes.writeUInt16LE(1, 20); audioBytes.writeUInt16LE(1, 22); audioBytes.writeUInt32LE(8000, 24); audioBytes.writeUInt32LE(8000, 28);
    audioBytes.writeUInt16LE(1, 32); audioBytes.writeUInt16LE(8, 34); audioBytes.write("data", 36); audioBytes.writeUInt32LE(800, 40);
    for (const state of ["ready", "pending", "deleting", "failed"] as const) {
      for (const type of (state === "ready" ? ["photo", "audio"] : ["photo"]) as ("photo" | "audio")[]) {
        const id = state === "ready" ? `recovery-${type}` : `recovery-${state}`;
        const file = `${id}.${type === "photo" ? "png" : "wav"}`;
        const bytes = type === "photo" ? photoBytes : audioBytes;
        await mkdir(path.join(uploads, type), { recursive: true });
        await writeFile(path.join(uploads, type, file), bytes);
        await source.mediaAsset.create({ data: { id, personId: "recovery-child", type, title: "Тест", storagePath: `storage/uploads/synthetic-recovery/recovery-child/${type}/${file}`, mimeType: type === "photo" ? "image/png" : "audio/wav", size: bytes.length, checksum: digest(bytes), state, cleanupAttempts: state === "failed" ? 5 : 0, lastErrorCode: state === "failed" ? "storage_delete_failed" : null } });
      }
    }
    await writeFile(path.join(uploads, "photo", "recovery-pending.png.partial"), photoBytes.subarray(0, 20));
    // No other process has these database names or paths; all fixture writes end here.
    phase = "frozen snapshot";
    const frozenAt = new Date().toISOString();
    const before = await snapshot(source);
    assertMigrationHistory(migrationFiles, await source.$queryRaw<MigrationHistoryRow[]>`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`);
    const metadata: BackupMetadata = { schemaRevision: [...migrationFiles.keys()].sort().at(-1)!, counts: {
      people: await source.person.count(), archivedPeople: await source.person.count({ where: { isArchived: true } }), relationships: await source.relationship.count(),
      stories: await source.story.count(), deletedStories: await source.story.count({ where: { deletedAt: { not: null } } }),
      mediaReady: await source.mediaAsset.count({ where: { state: "ready" } }), mediaPending: await source.mediaAsset.count({ where: { state: "pending" } }),
      mediaDeleting: await source.mediaAsset.count({ where: { state: "deleting" } }), mediaFailed: await source.mediaAsset.count({ where: { state: "failed" } }),
    } };
    phase = "dump and package";
    const dumpStarted = performance.now();
    docker("pg_dump", "-U", config.username, "--dbname=rodovo_ci_test", "--format=custom", "--file=/tmp/rodovo-recovery-source.dump", "--no-password");
    const dumpPath = path.join(temporary, "database.dump");
    command("docker", ["cp", `${containerId}:/tmp/rodovo-recovery-source.dump`, dumpPath]);
    const backup = path.join(temporary, "backup");
    const manifest = await createBackupPackage({ dumpPath, storageSnapshotPath: storage, destination: backup, metadata });
    await verifyBackupPackage(backup);
    const dumpAndPackageMs = Math.round(performance.now() - dumpStarted);
    phase = "restore files and database";
    const restoreStarted = performance.now();
    const restored = path.join(temporary, "restored");
    await restoreBackupPackage({ source: backup, destination: restored });
    command("docker", ["cp", path.join(restored, "database.dump"), `${containerId}:/tmp/rodovo-recovery-restore.dump`]);
    docker("pg_restore", "-U", config.username, "--dbname=rodovo_recovery_test", "--no-owner", "--no-privileges", "--exit-on-error", "--single-transaction", "--no-password", "/tmp/rodovo-recovery-restore.dump");
    const restoreMs = Math.round(performance.now() - restoreStarted);
    const validationStarted = performance.now();
    phase = "restored data equality";
    assert.deepEqual(await snapshot(target), before);
    assertMigrationHistory(migrationFiles, await target.$queryRaw<MigrationHistoryRow[]>`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`);
    assert.ok(await readValidSession("synthetic-recovery-session", (tokenHash) => target.session.findUnique({ where: { tokenHash }, include: { user: true } })));
    for (const asset of await target.mediaAsset.findMany({ where: { state: "ready" } })) {
      assert.ok(asset.storagePath.startsWith("storage/uploads/"));
      const bytes = await readFile(path.join(restored, asset.storagePath));
      assert.equal(bytes.length, asset.size); assert.equal(digest(bytes), asset.checksum);
    }
    await verifyBackupPackage(restored);
    const validationMs = Math.round(performance.now() - validationStarted);
    phase = "application HTTP acceptance";
    const httpStarted = performance.now();
    try {
      await runRecoveryHttpSmoke({ databaseUrl: config.target, storageRoot: path.join(restored, "storage"), email, password, familySlug: "synthetic-recovery", personId: "recovery-child", familyName: "Синтетическое восстановление", photoId: "recovery-photo", photoBytes, audioId: "recovery-audio", audioBytes, nonReadyMediaIds: ["recovery-pending", "recovery-deleting", "recovery-failed"] });
    } catch (error) {
      if (error instanceof Error && /^Recovery HTTP failed at (startup|login|family|anonymous-media|photo|audio-range|non-ready-media)\.$/.test(error.message)) phase = error.message;
      throw error;
    }
    report = { status: "PASS", snapshotId: manifest.snapshotId, frozenAt, verifiedAt: new Date().toISOString(), tables: tables.length, counts: metadata.counts, files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.size, 0), partialFilesPreserved: 1, dumpAndPackageMs, restoreMs, validationMs, httpMs: Math.round(performance.now() - httpStarted), restoreAndAcceptanceMs: Math.round(performance.now() - restoreStarted), lostFixtureRows: 0, lostFixtureFiles: 0 };
  } finally {
    await Promise.all([source.$disconnect(), target.$disconnect()]);
    if (temporary) {
      const resolved = path.resolve(temporary);
      assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
      assert.ok(path.basename(resolved).startsWith("rodovo-recovery-drill-"));
      await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
  console.log(JSON.stringify(report));
}

main().catch(() => { console.error(`Recovery drill refused or failed (${phase}).`); process.exitCode = 1; });
