import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("legacy upgrade refuses database access without explicit disposable authority", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/legacy-upgrade.ts"], {
    env: { ...process.env, RODOVO_CI_DATABASE: "", TEST_DATABASE_URL: "", DATABASE_URL: "postgresql://private:secret-marker@remote.invalid/private" },
    encoding: "utf8", timeout: 10000, shell: false,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Legacy upgrade refused or failed/);
  assert.doesNotMatch(result.stdout + result.stderr, /secret-marker|Environment variables loaded|Prisma schema loaded/);
});
