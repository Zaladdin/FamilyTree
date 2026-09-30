import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import { inspectStorageHealth } from "../lib/storage-health";

test("storage health is read-only, reports free space and detects insufficient capacity", async (t) => {
  const fs: typeof import("node:fs/promises") = createRequire(path.resolve("tests/storage-health.test.ts"))("node:fs/promises");
  const originalAccess = fs.access;
  t.mock.method(fs, "access", async (target: Parameters<typeof fs.access>[0], mode?: number) => {
    assert.equal(mode, constants.R_OK | constants.W_OK | constants.X_OK, "directories must allow traversal as well as reading and writing");
    return originalAccess(target, mode);
  });
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(parent, "rodovo-health-"));
  try {
    const healthy = await inspectStorageHealth(root, "1");
    assert.equal(healthy.state, "ok");
    assert.match(healthy.freeBytes!, /^\d+$/);
    assert.equal((await inspectStorageHealth(root, "9007199254740991")).state, "failed");
    assert.deepEqual(await readdir(root), []);
    await assert.rejects(inspectStorageHealth(path.join(root, "missing")));
    await assert.rejects(inspectStorageHealth(root, "invalid"));
    await assert.rejects(inspectStorageHealth("relative"));
  } finally {
    const target = await realpath(root);
    assert.equal(path.dirname(target), parent); assert.match(path.basename(target), /^rodovo-health-/);
    await rm(target, { recursive: true, force: true });
  }
});

test("storage health rejects a junction instead of probing its target", async () => {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(parent, "rodovo-health-"));
  try {
    const link = path.join(root, "linked");
    await symlink(parent, link, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(inspectStorageHealth(link), /Неверный каталог/);
    await rm(link);
  } finally {
    const target = await realpath(root);
    assert.equal(path.dirname(target), parent); assert.match(path.basename(target), /^rodovo-health-/);
    await rm(target, { recursive: true, force: true });
  }
});
