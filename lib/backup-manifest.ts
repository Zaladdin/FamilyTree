import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const COUNT_KEYS = ["people", "archivedPeople", "relationships", "stories", "deletedStories", "mediaReady", "mediaPending", "mediaDeleting", "mediaFailed"] as const;
const MAX_FILES = 100_000;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const MANIFEST_NAME = "manifest.json";

export type BackupMetadata = {
  schemaRevision: string;
  counts: Record<typeof COUNT_KEYS[number], number>;
};
type BackupFile = { path: string; size: number; sha256: string };
export type BackupManifest = {
  formatVersion: 1;
  purpose: "rodovo-offline-backup";
  snapshotId: string;
  createdAt: string;
  metadata: BackupMetadata;
  files: BackupFile[];
};

export class BackupError extends Error {}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BackupError("Некорректный manifest.");
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || !keys.every((key) => Object.hasOwn(result, key))) {
    throw new BackupError("Некорректные поля manifest.");
  }
  return result;
}

function assertPortablePath(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value || value.length > 1024 || value !== value.normalize("NFC") || /[\u0000-\u001f<>:"\\|?*]/u.test(value)) {
    throw new BackupError("Небезопасный путь в снимке.");
  }
  const segments = value.split("/");
  if (segments.length > 64 || segments.some((segment) => !segment || segment === "." || segment === ".." || /[. ]$/.test(segment) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) {
    throw new BackupError("Небезопасный путь в снимке.");
  }
}

export function parseBackupMetadata(value: unknown): BackupMetadata {
  const data = record(value, ["schemaRevision", "counts"]);
  if (typeof data.schemaRevision !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(data.schemaRevision)) {
    throw new BackupError("Некорректная ревизия схемы.");
  }
  const counts = record(data.counts, COUNT_KEYS);
  for (const key of COUNT_KEYS) {
    if (!Number.isSafeInteger(counts[key]) || (counts[key] as number) < 0) throw new BackupError("Некорректные контрольные количества.");
  }
  if ((counts.archivedPeople as number) > (counts.people as number) || (counts.deletedStories as number) > (counts.stories as number)) {
    throw new BackupError("Некорректные контрольные количества.");
  }
  return { schemaRevision: data.schemaRevision, counts: counts as BackupMetadata["counts"] };
}

function parseManifest(value: unknown): BackupManifest {
  const data = record(value, ["formatVersion", "purpose", "snapshotId", "createdAt", "metadata", "files"]);
  if (data.formatVersion !== 1 || data.purpose !== "rodovo-offline-backup") throw new BackupError("Неподдерживаемая версия manifest.");
  if (typeof data.snapshotId !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(data.snapshotId)) throw new BackupError("Некорректный идентификатор снимка.");
  if (typeof data.createdAt !== "string" || !Number.isFinite(Date.parse(data.createdAt)) || new Date(data.createdAt).toISOString() !== data.createdAt) throw new BackupError("Некорректное время снимка.");
  const metadata = parseBackupMetadata(data.metadata);
  if (!Array.isArray(data.files) || !data.files.length || data.files.length > MAX_FILES) throw new BackupError("Некорректный список файлов.");
  const seen = new Set<string>();
  let total = 0;
  const files = data.files.map((value): BackupFile => {
    const file = record(value, ["path", "size", "sha256"]);
    assertPortablePath(file.path);
    if (file.path !== "database.dump" && !file.path.startsWith("storage/uploads/")) throw new BackupError("Недопустимый путь в manifest.");
    const key = file.path.toLocaleLowerCase("en-US");
    if (seen.has(key)) throw new BackupError("Повтор пути в manifest.");
    seen.add(key);
    if (!Number.isSafeInteger(file.size) || (file.size as number) < 0 || (file.path === "database.dump" && !file.size)) throw new BackupError("Некорректный размер файла.");
    total += file.size as number;
    if (!Number.isSafeInteger(total)) throw new BackupError("Превышен поддерживаемый объём снимка.");
    if (typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new BackupError("Некорректная контрольная сумма.");
    return { path: file.path, size: file.size as number, sha256: file.sha256 };
  });
  if (!seen.has("database.dump")) throw new BackupError("Отсутствует database.dump.");
  return { formatVersion: 1, purpose: "rodovo-offline-backup", snapshotId: data.snapshotId, createdAt: data.createdAt, metadata, files };
}

async function existingPath(input: string, kind: "file" | "directory") {
  if (!input || !path.isAbsolute(input)) throw new BackupError("Укажите явный абсолютный путь.");
  const resolved = path.resolve(input);
  let current = path.parse(resolved).root;
  const segments = resolved.slice(current.length).split(path.sep).filter(Boolean);
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new BackupError("Символические ссылки и junction запрещены.");
    if (current !== resolved && !stat.isDirectory()) throw new BackupError("Некорректный родительский каталог.");
  }
  const stat = await lstat(resolved);
  if (stat.isSymbolicLink()) throw new BackupError("Символические ссылки и junction запрещены.");
  if (kind === "file" ? !stat.isFile() : !stat.isDirectory()) throw new BackupError("Некорректный тип источника.");
  return resolved;
}

function overlaps(first: string, second: string) {
  const a = first.toLocaleLowerCase("en-US");
  const b = second.toLocaleLowerCase("en-US");
  return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
}

async function newDestination(input: string, sources: string[], create: boolean) {
  if (!input || !path.isAbsolute(input)) throw new BackupError("Укажите явный абсолютный путь назначения.");
  const destination = path.resolve(input);
  if (sources.some((source) => overlaps(destination, source))) throw new BackupError("Источник и назначение пересекаются.");
  await existingPath(path.dirname(destination), "directory");
  try {
    await lstat(destination);
    throw new BackupError("Каталог назначения уже существует.");
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  if (create) {
    try { await mkdir(destination, { mode: 0o700 }); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") throw new BackupError("Каталог назначения уже существует.");
      throw error;
    }
  }
  return destination;
}

async function listFiles(root: string, excludeManifest = false): Promise<string[]> {
  const result: string[] = [];
  const seen = new Set<string>();
  let entries = 0;
  async function visit(directory: string, prefix: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      assertPortablePath(relative);
      if (++entries > MAX_FILES * 4) throw new BackupError("Слишком много записей в снимке.");
      const key = relative.toLocaleLowerCase("en-US");
      if (seen.has(key)) throw new BackupError("Повтор пути с разным регистром.");
      seen.add(key);
      const full = path.join(directory, entry.name);
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) throw new BackupError("Символические ссылки и junction запрещены.");
      if (stat.isDirectory()) await visit(full, relative);
      else if (stat.isFile()) {
        if (!(excludeManifest && relative === MANIFEST_NAME)) result.push(relative);
      } else throw new BackupError("Разрешены только обычные файлы и каталоги.");
      if (result.length > MAX_FILES) throw new BackupError("Слишком много файлов в снимке.");
    }
  }
  await visit(root, "");
  return result.sort();
}

async function hashFile(source: string, destination?: string): Promise<Omit<BackupFile, "path">> {
  const before = await lstat(source);
  if (!before.isFile() || before.isSymbolicLink()) throw new BackupError("Разрешены только обычные файлы без ссылок.");
  const input = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let output: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const opened = await input.stat();
    if (!opened.isFile() || before.dev !== opened.dev || before.ino !== opened.ino) throw new BackupError("Источник изменился во время чтения.");
    if (destination) output = await open(destination, "wx", 0o600);
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of input.createReadStream({ autoClose: false })) {
      const bytes = chunk as Buffer;
      size += bytes.length;
      if (!Number.isSafeInteger(size)) throw new BackupError("Превышен поддерживаемый размер файла.");
      hash.update(bytes);
      if (output) await output.writeFile(bytes);
    }
    const after = await input.stat();
    if (opened.size !== size || after.size !== size || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs) throw new BackupError("Источник изменился во время чтения.");
    if (output) await output.sync();
    return { size, sha256: hash.digest("hex") };
  } finally {
    await Promise.all([input.close(), output?.close()]);
  }
}

async function verifyPayload(root: string, manifest: BackupManifest) {
  const actual = await listFiles(root, true);
  const expected = manifest.files.map((file) => file.path).sort();
  if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) throw new BackupError("Состав файлов не совпадает с manifest.");
  for (const file of manifest.files) {
    const digest = await hashFile(path.join(root, ...file.path.split("/")));
    if (digest.size !== file.size || digest.sha256 !== file.sha256) throw new BackupError("Размер или контрольная сумма файла не совпадает.");
  }
}

async function readBoundedFile(source: string, limit: number) {
  const file = await existingPath(source, "file");
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw new BackupError("Файл метаданных слишком большой или имеет неверный тип.");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const value of handle.createReadStream({ autoClose: false })) {
      const chunk = value as Buffer;
      size += chunk.length;
      if (size > limit) throw new BackupError("Файл метаданных слишком большой.");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  } finally { await handle.close(); }
}

export async function readBackupMetadataFile(source: string): Promise<BackupMetadata> {
  const bytes = await readBoundedFile(source, 16_384);
  let raw: unknown;
  try { raw = JSON.parse(bytes.toString("utf8")); }
  catch { throw new BackupError("Не удалось прочитать JSON контрольных метаданных."); }
  return parseBackupMetadata(raw);
}

/** Reads only the explicitly selected offline package; never loads database configuration. */
export async function verifyBackupPackage(source: string): Promise<BackupManifest> {
  const root = await existingPath(source, "directory");
  const bytes = await readBoundedFile(path.join(root, MANIFEST_NAME), MAX_MANIFEST_BYTES);
  let raw: unknown;
  try { raw = JSON.parse(bytes.toString("utf8")); }
  catch { throw new BackupError("Manifest не является корректным JSON."); }
  const manifest = parseManifest(raw);
  await verifyPayload(root, manifest);
  return manifest;
}

async function publishManifest(destination: string, manifest: BackupManifest) {
  parseManifest(manifest);
  const serialized = JSON.stringify(manifest, null, 2) + "\n";
  if (Buffer.byteLength(serialized) > MAX_MANIFEST_BYTES) throw new BackupError("Manifest слишком большой.");
  await verifyPayload(destination, manifest);
  // The manifest is the completion marker. A failed copy remains visibly incomplete;
  // operators can inspect it, and this tool never recursively removes user paths.
  await writeFile(path.join(destination, MANIFEST_NAME), serialized, { flag: "wx", mode: 0o600 });
}

export async function createBackupPackage(params: {
  dumpPath: string; storageSnapshotPath: string; destination: string; metadata: BackupMetadata;
}): Promise<BackupManifest> {
  const metadata = parseBackupMetadata(params.metadata);
  const dump = await existingPath(params.dumpPath, "file");
  if (!(await lstat(dump)).size) throw new BackupError("Файл дампа пуст.");
  const storage = await existingPath(params.storageSnapshotPath, "directory");
  const media = await listFiles(storage);
  if (media.some((file) => !file.startsWith("uploads/"))) throw new BackupError("Недопустимый путь: снимок storage должен содержать только uploads/.");
  if (overlaps(dump, storage)) throw new BackupError("Источники дампа и storage пересекаются.");
  const destination = await newDestination(params.destination, [dump, storage], true);
  const files: BackupFile[] = [{ path: "database.dump", ...await hashFile(dump, path.join(destination, "database.dump")) }];
  for (const file of media) {
    const target = path.join(destination, "storage", ...file.split("/"));
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    files.push({ path: `storage/${file}`, ...await hashFile(path.join(storage, ...file.split("/")), target) });
  }
  // Empty storage is valid too; it can be selected as MEDIA_STORAGE_ROOT on restore.
  await mkdir(path.join(destination, "storage", "uploads"), { recursive: true, mode: 0o700 });
  const manifest: BackupManifest = { formatVersion: 1, purpose: "rodovo-offline-backup", snapshotId: randomUUID(), createdAt: new Date().toISOString(), metadata, files };
  await publishManifest(destination, manifest);
  return manifest;
}

/** Produces an isolated, verified filesystem copy. It does NOT execute pg_restore. */
export async function restoreBackupPackage(params: { source: string; destination: string }): Promise<BackupManifest> {
  const source = await existingPath(params.source, "directory");
  const manifest = await verifyBackupPackage(source);
  const destination = await newDestination(params.destination, [source], true);
  for (const file of manifest.files) {
    const target = path.join(destination, ...file.path.split("/"));
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const copied = await hashFile(path.join(source, ...file.path.split("/")), target);
    if (copied.size !== file.size || copied.sha256 !== file.sha256) throw new BackupError("Источник изменился после проверки контрольной суммы.");
  }
  await mkdir(path.join(destination, "storage", "uploads"), { recursive: true, mode: 0o700 });
  await publishManifest(destination, manifest);
  return manifest;
}

export async function inspectBackupInputs(params: { dumpPath: string; storageSnapshotPath: string; destination: string; metadata: BackupMetadata }) {
  parseBackupMetadata(params.metadata);
  const dump = await existingPath(params.dumpPath, "file");
  if (!(await lstat(dump)).size) throw new BackupError("Файл дампа пуст.");
  const storage = await existingPath(params.storageSnapshotPath, "directory");
  const files = await listFiles(storage);
  if (files.some((file) => !file.startsWith("uploads/"))) throw new BackupError("Недопустимый путь в storage.");
  if (overlaps(dump, storage)) throw new BackupError("Источники пересекаются.");
  await newDestination(params.destination, [dump, storage], false);
  return { mediaFiles: files.length };
}

export async function inspectRestoreDestination(source: string, destination: string) {
  await newDestination(destination, [await existingPath(source, "directory")], false);
}
