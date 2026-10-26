import test from "node:test";
import assert from "node:assert/strict";
import { getArchiveBenchmarkEnvironment } from "../scripts/archive-index-benchmark-environment";

const token = "99d084b9-6c8d-4688-81ae-6f247710ce57";
function configuration() {
  return {
    RODOVO_ARCHIVE_BENCHMARK: "disposable",
    RODOVO_CI_DATABASE: "disposable",
    TEST_DATABASE_URL: "postgresql://ci:synthetic-password@127.0.0.1:55439/rodovo_ci_test",
    DATABASE_URL: "postgresql://unit:unit@127.0.0.1:1/rodovo_unit_test",
    ARCHIVE_BENCHMARK_TOKEN: token,
    NODE_ENV: "production",
  };
}

test("archive benchmark guard explicitly binds both database variables to an isolated loopback test service", () => {
  const input = configuration();
  const env = getArchiveBenchmarkEnvironment(input);
  assert.equal(env.DATABASE_URL, input.TEST_DATABASE_URL);
  assert.equal(env.TEST_DATABASE_URL, input.TEST_DATABASE_URL);
  assert.equal(env.NODE_ENV, "test");
  assert.equal(env.ARCHIVE_BENCHMARK_TOKEN, token);
  assert.equal(input.NODE_ENV, "production", "caller environment must remain unchanged");
});

test("archive benchmark requires both explicit disposable authorities and a test URL", () => {
  for (const key of ["RODOVO_ARCHIVE_BENCHMARK", "RODOVO_CI_DATABASE", "TEST_DATABASE_URL"] as const) {
    for (const value of [undefined, "", "true", "production"]) {
      assert.throws(() => getArchiveBenchmarkEnvironment({ ...configuration(), [key]: value }));
    }
  }
});

test("archive benchmark refuses remote, default, privileged or wrong test database endpoints", () => {
  for (const url of [
    "postgresql://ci:secret@remote.example:55439/rodovo_ci_test",
    "postgresql://ci:secret@localhost:55439/rodovo_ci_test",
    "postgresql://ci:secret@[::1]:55439/rodovo_ci_test",
    "postgresql://ci:secret@127.0.0.1/rodovo_ci_test",
    "postgresql://ci:secret@127.0.0.1:5432/rodovo_ci_test",
    "postgresql://ci:secret@127.0.0.1:1024/rodovo_ci_test",
    "postgresql://ci:secret@127.0.0.1:55439/rodovo_test",
    "postgresql://ci:secret@127.0.0.1:55439/rodovo",
    "https://127.0.0.1:55439/rodovo_ci_test",
    "not-a-url",
  ]) assert.throws(() => getArchiveBenchmarkEnvironment({ ...configuration(), TEST_DATABASE_URL: url }));
});

test("archive benchmark rejects the current primary database even with changed credentials", () => {
  assert.throws(() => getArchiveBenchmarkEnvironment({
    ...configuration(), DATABASE_URL: "postgres://different:private-primary@127.0.0.1:55439/rodovo_ci_test",
  }), /must not refer to the current DATABASE_URL/);
});

test("archive benchmark rejects URL options, fragments, whitespace and control-character ambiguity", () => {
  const base = configuration().TEST_DATABASE_URL;
  for (const url of [base + "?schema=public", base + "#fragment", " " + base, base + " ", base.replace("ci:", "ci:\n"), base.replace("127.0.0.1", "127.0.0.\t1")]) {
    assert.throws(() => getArchiveBenchmarkEnvironment({ ...configuration(), TEST_DATABASE_URL: url }));
  }
});

test("archive benchmark requires an exact UUID ownership token", () => {
  for (const value of [undefined, "", "not-a-uuid", token + " ", "{" + token + "}", token.replace(/-/g, "")]) {
    assert.throws(() => getArchiveBenchmarkEnvironment({ ...configuration(), ARCHIVE_BENCHMARK_TOKEN: value }));
  }
});

test("archive benchmark guard errors never expose supplied connection values or tokens", () => {
  const secret = "private-benchmark-value";
  for (const input of [
    { ...configuration(), TEST_DATABASE_URL: `postgresql://ci:${secret}@remote.example:55439/rodovo_ci_test` },
    { ...configuration(), ARCHIVE_BENCHMARK_TOKEN: secret },
  ]) {
    assert.throws(() => getArchiveBenchmarkEnvironment(input), (error) =>
      error instanceof Error && !error.message.includes(secret) && !error.message.includes("postgresql://"));
  }
});
