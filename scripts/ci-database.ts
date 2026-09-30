import { spawnSync } from "node:child_process";
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { getCiDatabaseEnvironment } from "./ci-database-environment";
import { assertMigrationHistory, type MigrationHistoryRow } from "./ci-migration-history";

// No dotenv import. Validate before loading Prisma or starting a child process.
async function main() {
  if (process.argv.length !== 2) throw new Error("Usage: npm run ci:database");
  const env: NodeJS.ProcessEnv = {
    ...getCiDatabaseEnvironment(process.env),
    NODE_ENV: process.env.NODE_ENV ?? "test",
  };
  const prismaCli = path.join(process.cwd(), "node_modules/prisma/build/index.js");
  for (const args of [
    ["migrate", "deploy"],
    ["migrate", "status"],
    ["migrate", "diff", "--from-schema-datasource", "prisma/schema.prisma", "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"],
  ]) {
    const result = spawnSync(process.execPath, [prismaCli, ...args], { env, stdio: "inherit", shell: false });
    if (result.error || result.status !== 0) throw new Error("CI migration/schema validation failed; history was not repaired automatically.");
  }
  const migrationDirectory = path.join(process.cwd(), "prisma/migrations");
  const files = new Map<string, string>();
  for (const entry of await readdir(migrationDirectory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const sql = await readFile(path.join(migrationDirectory, entry.name, "migration.sql"));
      files.set(entry.name, createHash("sha256").update(sql).digest("hex"));
    }
  }
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  try {
    const rows = await prisma.$queryRaw<MigrationHistoryRow[]>`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`;
    assertMigrationHistory(files, rows);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Database driver errors can contain connection details. Only print our fixed messages.
  const message = error instanceof Error && /^(CI |Integration tests require|TEST_DATABASE_URL |Migration history )/.test(error.message)
    ? error.message : "CI database validation failed.";
  console.error(message);
  process.exitCode = 1;
});
