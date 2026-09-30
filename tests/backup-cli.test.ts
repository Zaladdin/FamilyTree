import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const script = path.resolve("scripts/backup-package.ts");
function cli(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
    encoding: "utf8", shell: false, timeout: 20_000,
    env: { ...process.env, DATABASE_URL: "postgresql://never-read:private-secret@127.0.0.1:1/no_access" },
  });
}

test("backup CLI defaults to dry run and requires --write for creating and restoring files", async () => {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(parent, "rodovo-backup-cli-test-"));
  try {
    const dump = path.join(root, "source.dump");
    const storage = path.join(root, "snapshot");
    const metadata = path.join(root, "metadata.json");
    const destination = path.join(root, "bundle");
    const restored = path.join(root, "restored");
    await mkdir(path.join(storage, "uploads"), { recursive: true });
    await writeFile(dump, "synthetic-not-postgres");
    await writeFile(metadata, JSON.stringify({ schemaRevision: "synthetic", counts: { people: 0, archivedPeople: 0, relationships: 0, stories: 0, deletedStories: 0, mediaReady: 0, mediaPending: 0, mediaDeleting: 0, mediaFailed: 0 } }));
    const create = ["create", "--dump", dump, "--storage", storage, "--destination", destination, "--metadata", metadata];
    const dry = cli(create);
    assert.ifError(dry.error);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /План/);
    await assert.rejects(() => realpath(destination), /ENOENT/);
    const written = cli([...create, "--write"]);
    assert.equal(written.status, 0, written.stderr);
    assert.match(written.stdout, /PostgreSQL не проверено/);
    assert.match(written.stdout, /"event":"backup_created"/);
    const verified = cli(["verify", "--source", destination]);
    assert.equal(verified.status, 0);
    assert.match(verified.stdout, /"event":"backup_verified"/);
    const restore = ["restore", "--source", destination, "--destination", restored];
    assert.equal(cli(restore).status, 0);
    await assert.rejects(() => realpath(restored), /ENOENT/);
    const restoredResult = cli([...restore, "--write"]);
    assert.equal(restoredResult.status, 0, restoredResult.stderr);
    assert.match(restoredResult.stdout, /"event":"backup_restored"/);
    assert.equal(cli(["verify", "--source", restored]).status, 0);
    const invalid = cli(["verify", "--source", path.join(root, "not-found")]);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stdout, /"event":"backup_failed"/);
    assert.doesNotMatch(invalid.stdout, /private-secret|postgresql:|not-found/);
    assert.doesNotMatch(invalid.stderr, /private-secret|postgresql:|not-found/);
  } finally {
    const resolved = await realpath(root);
    assert.equal(path.dirname(resolved), parent);
    assert.match(path.basename(resolved), /^rodovo-backup-cli-test-/);
    await rm(resolved, { recursive: true, force: true });
  }
});

test("backup CLI rejects implicit paths, unexpected flags and unsafe operations without exposing arguments", () => {
  for (const args of [[], ["create"], ["reset"], ["verify", "--source", "relative"], ["verify", "--source", "private-secret", "--write"], ["create", "--dump", "a", "--dump", "b"]]) {
    const result = cli(args);
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /private-secret|postgresql:/);
  }
});
