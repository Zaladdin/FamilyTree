import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { assertTestDatabaseUrl, UNIT_DATABASE_URL } from "../scripts/test-environment";

test("integration DB guard rejects missing, malformed, and ordinary application databases", () => {
  for (const value of [undefined, "", "not-a-url", "https://example.com/rodovo_test", "postgresql://localhost/rodovo", "postgresql://localhost/contest"]) {
    assert.throws(() => assertTestDatabaseUrl(value));
  }
  assert.equal(assertTestDatabaseUrl("postgresql://localhost/rodovo_test"), "postgresql://localhost/rodovo_test");
  assert.equal(assertTestDatabaseUrl("postgres://localhost/test_rodovo"), "postgres://localhost/test_rodovo");
});

test("integration DB guard rejects the active database even if credentials or schema differ", () => {
  assert.throws(
    () => assertTestDatabaseUrl(
      "postgresql://tester:other-secret@localhost:5432/rodovo_test?schema=integration",
      "postgres://app:private-secret@localhost/rodovo_test?schema=public",
    ),
    /must not refer to the current DATABASE_URL/,
  );
});

test("unit DB URL cannot target the normal PostgreSQL port", () => {
  const url = new URL(UNIT_DATABASE_URL);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "1");
});

test("integration guard does not expose credentials in errors", () => {
  assert.throws(
    () => assertTestDatabaseUrl("postgresql://user:sensitive-password@localhost/rodovo"),
    (error) => error instanceof Error && !error.message.includes("sensitive-password"),
  );
});

test("direct integration helper import rejects an active test-named database before loading Prisma", () => {
  const result = spawnSync(process.execPath, [
    "--import", "tsx", "--eval",
    "import('./tests/integration/helpers.ts').catch((error) => { console.error(error.message); process.exitCode = 1; })",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://app:private-secret@127.0.0.1:1/rodovo_test?schema=public",
      TEST_DATABASE_URL: "postgresql://tester:other-secret@127.0.0.1:1/rodovo_test?schema=integration",
    },
    encoding: "utf8",
    timeout: 10000,
    shell: false,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must not refer to the current DATABASE_URL/);
  assert.doesNotMatch(result.stderr, /private-secret|other-secret/);
});
