import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const bundle = path.join(process.cwd(), "docs/operations/archive-index-rollback");
const rollback = "20261025010000_rollback_archive_pagination_index";
const digest = (value: Buffer) => createHash("sha256").update(value).digest("hex");

test("rollback release is isolated and matches reviewed SQL across checkout line endings", async () => {
  const main = path.join(process.cwd(), "prisma/migrations");
  const names = (await readdir(main, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.equal(names.length, 9, "Re-review the frozen rollback release when migration history advances.");
  assert.ok(!names.includes(rollback));
  for (const name of names) {
    const frozen = await readFile(path.join(bundle, "migrations", name, "migration.sql"), "utf8");
    const source = await readFile(path.join(main, name, "migration.sql"), "utf8");
    assert.equal(frozen.replace(/\r\n/g, "\n"), source.replace(/\r\n/g, "\n"));
  }
  assert.equal((await readFile(path.join(bundle, "migrations/migration_lock.toml"), "utf8")).replace(/\r\n/g, "\n"), (await readFile(path.join(main, "migration_lock.toml"), "utf8")).replace(/\r\n/g, "\n"));
  assert.equal(digest(await readFile(path.join(bundle, "migrations", rollback, "migration.sql"))), "86f1956386e23ec112157dbcb0f8ceae0116c7aa6c8635986a7fd1c6e097d502");
});

test("rollback schema removes only the archive index and DROP cannot silently remove dependencies", async () => {
  const normalize = (value: string) => value.replace(/\r\n/g, "\n");
  const current = normalize(await readFile(path.join(process.cwd(), "prisma/schema.prisma"), "utf8"));
  const frozen = normalize(await readFile(path.join(bundle, "schema.prisma"), "utf8"));
  const index = "  @@index([familyId, isArchived, id])\n";
  assert.equal(current.split(index).length, 2);
  assert.equal(frozen, current.replace(index, ""), "Other schema changes require a new review of the rollback snapshot.");
  const sql = await readFile(path.join(bundle, "migrations", rollback, "migration.sql"), "utf8");
  assert.equal(sql.replace(/^--.*$/gm, "").trim(), 'DROP INDEX public."Person_familyId_isArchived_id_idx" RESTRICT;');
});
