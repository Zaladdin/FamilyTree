import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.join(process.cwd(), "docs/operations/archive-index-release-pg18");
const create = "20261025000000_archive_pagination_index";
const drop = "20261025010000_rollback_archive_pagination_index";
const sibling = "20260928000000_direct_sibling_relationship";
const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const migrationNames = async (profile: string) => (await readdir(path.join(root, profile, "migrations"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

test("PG18 release historical bytes match the recorded eight production checksums", async () => {
  const baseline = JSON.parse(await readFile(path.join(root, "baseline-checksums.json"), "utf8")) as {
    migrations: { migration: string; checksum: string }[];
  };
  assert.equal(baseline.migrations.length, 8);
  assert.equal(new Set(baseline.migrations.map((entry) => entry.migration)).size, 8);
  for (const profile of ["apply", "rollback"]) {
    for (const entry of baseline.migrations) {
      const bytes = await readFile(path.join(root, profile, "migrations", entry.migration, "migration.sql"));
      assert.equal(digest(bytes), entry.checksum);
      const original = await readFile(path.join(process.cwd(), "prisma/migrations", entry.migration, "migration.sql"));
      if (entry.migration === sibling) {
        assert.equal(bytes.toString(), original.toString().replace(/\r\n/g, "\n"));
        assert.ok(!bytes.includes(Buffer.from("\r")));
      } else assert.equal(bytes.toString().replace(/\r\n/g, "\n"), original.toString().replace(/\r\n/g, "\n"), "Release SQL must match source across Git checkout line endings; manifest pins exact release bytes.");
    }
  }
});

test("PG18 apply and rollback are separate exact migration sets with immutable CREATE and DROP", async () => {
  const apply = await migrationNames("apply");
  const rollback = await migrationNames("rollback");
  assert.equal(apply.length, 9);
  assert.equal(rollback.length, 10);
  assert.equal(apply.at(-1), create);
  assert.equal(rollback.at(-1), drop);
  assert.deepEqual(rollback, [...apply, drop]);
  const main = (await readdir(path.join(process.cwd(), "prisma/migrations"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  assert.ok(!main.includes(drop), "Rollback must not become pending in the main deploy.");
  for (const profile of ["apply", "rollback"]) {
    assert.equal(digest(await readFile(path.join(root, profile, "migrations", create, "migration.sql"))), "a84eb87e424bea2cc6d9a55e896c7b5c5bec6d475dc905cbb9a6121c4e9ec97d");
  }
  assert.equal(digest(await readFile(path.join(root, "rollback/migrations", drop, "migration.sql"))), "86f1956386e23ec112157dbcb0f8ceae0116c7aa6c8635986a7fd1c6e097d502");
  const normalize = (value: string) => value.replace(/\r\n/g, "\n");
  const applySchema = await readFile(path.join(root, "apply/schema.prisma"), "utf8");
  const rollbackSchema = await readFile(path.join(root, "rollback/schema.prisma"), "utf8");
  const index = "  @@index([familyId, isArchived, id])\n";
  assert.equal(normalize(applySchema).split(index).length, 2);
  assert.equal(normalize(rollbackSchema), normalize(applySchema).replace(index, ""));
  assert.equal(normalize(applySchema), normalize(await readFile(path.join(process.cwd(), "prisma/schema.prisma"), "utf8")), "Re-review release snapshot when the main schema changes.");
});

test("PG18 release manifest verifies every delivered file byte and no unexpected files", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as {
    files: { path: string; sha256: string; bytes: number }[];
  };
  const files: string[] = [];
  async function walk(relative = "") {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(name);
      else {
        assert.ok(entry.isFile(), "Release cannot contain symlinks or special entries.");
        if (name !== "manifest.json") files.push(name);
      }
    }
  }
  await walk();
  assert.deepEqual(files.sort(), manifest.files.map((entry) => entry.path).sort());
  for (const entry of manifest.files) {
    assert.ok(!entry.path.includes("..") && !path.isAbsolute(entry.path));
    const bytes = await readFile(path.join(root, entry.path));
    assert.equal(bytes.length, entry.bytes, entry.path);
    assert.equal(digest(bytes), entry.sha256, entry.path);
  }
});
