import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { assertMediaMaintenanceEnvironment, parseMediaMaintenanceArguments } from "../scripts/media-maintenance";

test("maintenance requires explicit authority and defaults to a bounded dry run", () => {
  assert.throws(() => parseMediaMaintenanceArguments([]), /confirm-maintenance/);
  assert.deepEqual(parseMediaMaintenanceArguments(["--confirm-maintenance"]), {
    dryRun: true, writersStopped: false, retryExhausted: false, diagnostics: false, limit: 20,
  });
  for (const args of [["--apply"], ["--confirm-file-deletion"], ["--apply", "--confirm-file-deletion", "--dry-run"], ["--retry-exhausted"], ["--limit", "101"], ["--limit", "NaN"], ["--anything"]]) {
    assert.throws(() => parseMediaMaintenanceArguments(["--confirm-maintenance", ...args]));
  }
  const applied = parseMediaMaintenanceArguments(["--confirm-maintenance", "--apply", "--confirm-file-deletion", "--writers-stopped", "--retry-exhausted", "--limit", "1"]);
  assert.equal(applied.dryRun, false); assert.equal(applied.retryExhausted, true); assert.equal(applied.limit, 1);
});

test("maintenance never falls back to DATABASE_URL or an implicit storage root", () => {
  const database = "postgresql://maintenance:secret@127.0.0.1:1/rodovo_test";
  assert.throws(() => assertMediaMaintenanceEnvironment({ DATABASE_URL: database }), /explicit/);
  assert.throws(() => assertMediaMaintenanceEnvironment({ MEDIA_MAINTENANCE_DATABASE_URL: database, MEDIA_STORAGE_ROOT: "storage" }), /absolute/);
  assert.equal(assertMediaMaintenanceEnvironment({ MEDIA_MAINTENANCE_DATABASE_URL: database, MEDIA_STORAGE_ROOT: path.resolve("tmp/synthetic-storage") }), database);
  assert.throws(() => assertMediaMaintenanceEnvironment({ MEDIA_MAINTENANCE_DATABASE_URL: "private invalid secret" }), (error: unknown) => {
    assert.doesNotMatch(String(error), /private invalid secret/); return true;
  });
});
