import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBackupPackage, restoreBackupPackage, verifyBackupPackage, type BackupMetadata } from "@/lib/backup-manifest";

const metadata: BackupMetadata = {
  schemaRevision: "20260928050000_media_lifecycle",
  counts: { people: 4, archivedPeople: 1, relationships: 3, stories: 2, deletedStories: 1, mediaReady: 2, mediaPending: 0, mediaDeleting: 0, mediaFailed: 0 },
};

async function fixture(run: (root: string, dump: string, storage: string) => Promise<void>) {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(parent, "rodovo-backup-test-"));
  try {
    const storage = path.join(root, "snapshot-storage");
    await mkdir(path.join(storage, "uploads", "family", "person", "photo"), { recursive: true });
    await mkdir(path.join(storage, "uploads", "family", "person", "audio"), { recursive: true });
    await writeFile(path.join(storage, "uploads", "family", "person", "photo", "image.jpg"), Buffer.from([255, 216, 255, 1]));
    await writeFile(path.join(storage, "uploads", "family", "person", "audio", "voice.mp3"), "synthetic-audio");
    const dump = path.join(root, "snapshot.dump");
    // Deliberately NOT a PostgreSQL dump: these are filesystem integrity tests only.
    await writeFile(dump, "synthetic-database-bytes");
    await run(root, dump, storage);
  } finally {
    const resolved = await realpath(root);
    assert.equal(path.dirname(resolved), parent);
    assert.match(path.basename(resolved), /^rodovo-backup-test-/);
    await rm(resolved, { recursive: true, force: true });
  }
}

test("offline backup and isolated restore preserve bytes, keys and counts without connecting to a database", async () => fixture(async (root, dump, storage) => {
  const destination = path.join(root, "bundle");
  const manifest = await createBackupPackage({ dumpPath: dump, storageSnapshotPath: storage, destination, metadata });
  assert.equal(manifest.files.length, 3);
  assert.deepEqual(manifest.metadata, metadata);
  assert.deepEqual(manifest.files.map((file) => file.path), ["database.dump", "storage/uploads/family/person/audio/voice.mp3", "storage/uploads/family/person/photo/image.jpg"]);
  assert.equal((await verifyBackupPackage(destination)).files.length, 3);
  const restored = path.join(root, "restored");
  await restoreBackupPackage({ source: destination, destination: restored });
  assert.deepEqual(await verifyBackupPackage(restored), manifest);
  assert.deepEqual(await readFile(path.join(restored, "database.dump")), await readFile(dump));
  assert.deepEqual(await readFile(path.join(restored, "storage", "uploads", "family", "person", "photo", "image.jpg")), await readFile(path.join(storage, "uploads", "family", "person", "photo", "image.jpg")));
}));

test("backup and restore never overwrite an existing destination", async () => fixture(async (root, dump, storage) => {
  const destination = path.join(root, "bundle");
  await createBackupPackage({ dumpPath: dump, storageSnapshotPath: storage, destination, metadata });
  const before = await readFile(path.join(destination, "manifest.json"));
  await assert.rejects(() => createBackupPackage({ dumpPath: dump, storageSnapshotPath: storage, destination, metadata }), /существует/);
  await assert.rejects(() => restoreBackupPackage({ source: destination, destination }), /существует|пересека/);
  assert.deepEqual(await readFile(path.join(destination, "manifest.json")), before);
}));

test("verification rejects corrupted, missing and unexpected files", async () => fixture(async (root, dump, storage) => {
  const destination = path.join(root, "bundle");
  await createBackupPackage({ dumpPath: dump, storageSnapshotPath: storage, destination, metadata });
  const copy = path.join(destination, "database.dump");
  const original = await readFile(copy);
  await writeFile(copy, Buffer.alloc(original.length, 120));
  await assert.rejects(() => verifyBackupPackage(destination), /контрольн/);
  await writeFile(copy, original);
  await writeFile(path.join(destination, "extra.txt"), "unlisted");
  await assert.rejects(() => verifyBackupPackage(destination), /состав/i);
  await rm(path.join(destination, "extra.txt"));
  await rm(copy);
  await assert.rejects(() => verifyBackupPackage(destination), /состав/i);
  await assert.rejects(() => restoreBackupPackage({ source: destination, destination: path.join(root, "unsafe-restore") }), /состав/i);
  await assert.rejects(() => realpath(path.join(root, "unsafe-restore")), /ENOENT/);
}));

test("an incomplete package without its publication manifest cannot be restored", async () => fixture(async (root) => {
  const incomplete = path.join(root, "incomplete");
  await mkdir(incomplete);
  await writeFile(path.join(incomplete, "database.dump"), "unfinished");
  const restored = path.join(root, "must-not-exist");
  await assert.rejects(() => restoreBackupPackage({ source: incomplete, destination: restored }));
  await assert.rejects(() => realpath(restored), /ENOENT/);
}));

test("streamed backup retains a multi-chunk original byte for byte", async () => fixture(async (root, dump, storage) => {
  const original = Buffer.alloc(2 * 1024 * 1024 + 41);
  for (let index = 0; index < original.length; index++) original[index] = index % 251;
  await writeFile(dump, original);
  const bundle = path.join(root, "multi-chunk");
  const manifest = await createBackupPackage({ dumpPath: dump, storageSnapshotPath: storage, destination: bundle, metadata });
  assert.equal(manifest.files[0].size, original.length);
  assert.deepEqual(await readFile(path.join(bundle, "database.dump")), original);
}));

test("manifest rejects traversal, absolute paths, Windows aliases and case collisions before restore", async () => fixture(async (root, dump, storage) => {
  const destination = path.join(root, "bundle");
  const manifest = await createBackupPackage({ dumpPath: dump, storageSnapshotPath: storage, destination, metadata });
  for (const unsafe of ["../outside", "/absolute", "C:/escape", "storage\\uploads\\escape", "storage/uploads/CON", "storage/uploads/name.", "storage/uploads/name ", "storage/uploads/a:stream", "storage/uploads/../escape"]) {
    const poisoned = structuredClone(manifest);
    poisoned.files[1].path = unsafe;
    await writeFile(path.join(destination, "manifest.json"), JSON.stringify(poisoned));
    await assert.rejects(() => verifyBackupPackage(destination), /путь/);
  }
  const duplicate = structuredClone(manifest);
  duplicate.files.push({ ...duplicate.files[1], path: duplicate.files[1].path.replace("voice.mp3", "VOICE.mp3") });
  await writeFile(path.join(destination, "manifest.json"), JSON.stringify(duplicate));
  await assert.rejects(() => verifyBackupPackage(destination), /повтор|путь/i);
}));

test("manifest rejects unknown fields, invalid counts, unsupported versions and malformed checksums", async () => fixture(async (root, dump, storage) => {
  const destination = path.join(root, "bundle");
  const manifest = await createBackupPackage({ dumpPath: dump, storageSnapshotPath: storage, destination, metadata });
  const invalid: unknown[] = [
    { ...manifest, formatVersion: 2 },
    { ...manifest, databaseUrl: "postgresql://secret.invalid" },
    { ...manifest, createdAt: "yesterday" },
    { ...manifest, metadata: { ...metadata, counts: { ...metadata.counts, people: -1 } } },
    { ...manifest, files: manifest.files.map((file) => ({ ...file, sha256: "bad" })) },
    { ...manifest, files: [] },
  ];
  for (const value of invalid) {
    await writeFile(path.join(destination, "manifest.json"), JSON.stringify(value));
    await assert.rejects(() => verifyBackupPackage(destination));
  }
}));

test("junctions and linked source or destination ancestors are rejected", async () => fixture(async (root, dump, storage) => {
  const outside = path.join(root, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "private.txt"), "must-not-copy");
  await symlink(outside, path.join(storage, "uploads", "linked"), "junction");
  await assert.rejects(() => createBackupPackage({ dumpPath: dump, storageSnapshotPath: storage, destination: path.join(root, "linked-bundle"), metadata }), /ссыл/);
  await assert.rejects(() => realpath(path.join(root, "linked-bundle")), /ENOENT/);
  await rm(path.join(storage, "uploads", "linked"));
  await symlink(storage, path.join(root, "alias-storage"), "junction");
  await assert.rejects(() => createBackupPackage({ dumpPath: dump, storageSnapshotPath: path.join(root, "alias-storage"), destination: path.join(root, "another-bundle"), metadata }), /ссыл/);
  await symlink(outside, path.join(root, "alias-parent"), "junction");
  await assert.rejects(() => createBackupPackage({ dumpPath: dump, storageSnapshotPath: storage, destination: path.join(root, "alias-parent", "bundle"), metadata }), /ссыл/);
}));

test("backup requires a separate destination, positive dump size and only original upload paths", async () => fixture(async (root, dump, storage) => {
  await assert.rejects(() => createBackupPackage({ dumpPath: dump, storageSnapshotPath: storage, destination: path.join(storage, "bundle"), metadata }), /пересека/);
  await writeFile(dump, "");
  await assert.rejects(() => createBackupPackage({ dumpPath: dump, storageSnapshotPath: storage, destination: path.join(root, "empty-dump"), metadata }), /пуст/);
  await writeFile(dump, "synthetic");
  await writeFile(path.join(storage, ".env"), "not included");
  await assert.rejects(() => createBackupPackage({ dumpPath: dump, storageSnapshotPath: storage, destination: path.join(root, "secrets"), metadata }), /путь/);
}));
