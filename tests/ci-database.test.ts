import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { getCiDatabaseEnvironment } from "../scripts/ci-database-environment";
import { assertMigrationHistory } from "../scripts/ci-migration-history";

const safe = { RODOVO_CI_DATABASE: "disposable", TEST_DATABASE_URL: "postgresql://ci:ci@127.0.0.1:5432/rodovo_ci_test" };
test("CI migrations require explicit disposable loopback database", () => {
  assert.equal(getCiDatabaseEnvironment(safe).DATABASE_URL, safe.TEST_DATABASE_URL);
  for (const changes of [
    { RODOVO_CI_DATABASE: undefined }, { TEST_DATABASE_URL: undefined },
    { TEST_DATABASE_URL: "postgresql://ci:private@remote.invalid/rodovo_ci_test" },
    { TEST_DATABASE_URL: "postgresql://ci:private@127.0.0.1/rodovo" },
    { TEST_DATABASE_URL: safe.TEST_DATABASE_URL + "?host=remote.invalid" },
    { DATABASE_URL: safe.TEST_DATABASE_URL },
  ]) assert.throws(() => getCiDatabaseEnvironment({ ...safe, ...changes }));
});

test("migration history rejects missing, edited, duplicate and unfinished migrations", () => {
  const files = new Map([["initial", "abc"]]);
  const row = { migration_name: "initial", checksum: "abc", finished_at: new Date(), rolled_back_at: null };
  assertMigrationHistory(files, [row]);
  for (const rows of [[], [row, row], [{ ...row, checksum: "edited" }], [{ ...row, finished_at: null }], [{ ...row, migration_name: "unknown" }], [{ ...row, rolled_back_at: new Date() }]]) {
    assert.throws(() => assertMigrationHistory(files, rows));
  }
});

test("CI guard preserves unrelated environment and never leaks secrets", () => {
  const result = getCiDatabaseEnvironment({ ...safe, DATABASE_URL: "postgresql://unit:unit@127.0.0.1:1/rodovo_unit_test", PATH: "tools" });
  assert.equal(result.PATH, "tools");
  assert.equal(result.TEST_DATABASE_URL, safe.TEST_DATABASE_URL);
  assert.throws(() => getCiDatabaseEnvironment({ ...safe, TEST_DATABASE_URL: "private-secret" }), (error) => error instanceof Error && !error.message.includes("private-secret"));
});

test("direct CI migration command fails before Prisma without explicit authority", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/ci-database.ts"], {
    env: { ...process.env, RODOVO_CI_DATABASE: "", TEST_DATABASE_URL: "", DATABASE_URL: "postgresql://private:private-secret@remote.invalid/private" },
    encoding: "utf8", timeout: 10000, shell: false,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /require RODOVO_CI_DATABASE/);
  assert.doesNotMatch(result.stderr + result.stdout, /private-secret|Prisma schema loaded|Environment variables loaded/);
});
