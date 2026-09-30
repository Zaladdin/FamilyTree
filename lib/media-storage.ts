import { constants } from "node:fs";
import { link, lstat, mkdir, open, opendir, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { MediaAssetType } from "@/lib/types";
import { HttpError } from "@/lib/http-error";

const allowedMimeTypes: Record<MediaAssetType, string[]> = {
  photo: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  audio: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/webm", "audio/mp4"],
};

const maxUploadBytes: Record<MediaAssetType, number> = {
  photo: 10 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
};

// Guard the declared file size BEFORE the file is read into memory, so an
// oversized upload cannot exhaust server memory via file.arrayBuffer().
export function assertUploadSizeWithinLimit(fileSize: number, type: MediaAssetType) {
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
    throw new HttpError(400, "Файл пустой.");
  }

  if (fileSize > maxUploadBytes[type]) {
    throw new HttpError(413,
      type === "photo"
        ? "Фото слишком большое. Максимум 10 MB."
        : "Аудиофайл слишком большой. Максимум 20 MB.",
    );
  }
}

function getExtension(mimeType: string) {
  const mimeMap: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/webm": ".webm",
    "audio/mp4": ".m4a",
  };

  const extension = mimeMap[mimeType];

  if (!extension) {
    throw new Error("Не удалось определить безопасное расширение файла.");
  }

  return extension;
}

function matchesSignature(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((value, index) => bytes[offset + index] === value);
}

function matchesAscii(bytes: Uint8Array, value: string, offset = 0) {
  return Array.from(value).every((char, index) => bytes[offset + index] === char.charCodeAt(0));
}

export function detectMimeTypeForUpload(bytes: Uint8Array, type: MediaAssetType) {
  if (type === "photo") {
    if (matchesSignature(bytes, [0xff, 0xd8, 0xff])) {
      return "image/jpeg";
    }

    if (matchesSignature(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
      return "image/png";
    }

    if (matchesAscii(bytes, "GIF87a") || matchesAscii(bytes, "GIF89a")) {
      return "image/gif";
    }

    if (matchesAscii(bytes, "RIFF") && matchesAscii(bytes, "WEBP", 8)) {
      return "image/webp";
    }
  }

  if (type === "audio") {
    if (matchesAscii(bytes, "ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
      return "audio/mpeg";
    }

    if (matchesAscii(bytes, "RIFF") && matchesAscii(bytes, "WAVE", 8)) {
      return "audio/wav";
    }

    if (matchesAscii(bytes, "OggS")) {
      return "audio/ogg";
    }

    if (matchesSignature(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
      return "audio/webm";
    }

    if (matchesAscii(bytes, "ftyp", 4)) {
      return "audio/mp4";
    }
  }

  throw new HttpError(400,
    type === "photo"
      ? "Не удалось подтвердить формат изображения по содержимому файла."
      : "Не удалось подтвердить формат аудиофайла по содержимому файла.",
  );
}

export function validateUpload(params: {
  fileSize: number;
  type: MediaAssetType;
  detectedMimeType: string;
}) {
  const { fileSize, type, detectedMimeType } = params;

  assertUploadSizeWithinLimit(fileSize, type);

  if (!allowedMimeTypes[type].includes(detectedMimeType)) {
    throw new HttpError(400,
      type === "photo"
        ? "Разрешены только изображения JPG, PNG, WebP или GIF."
        : "Разрешены только аудиофайлы MP3, WAV, OGG, WebM или M4A.",
    );
  }
}

export type PreparedUpload = {
  storagePath: string;
  size: number;
  mimeType: string;
  title: string;
  checksum: string;
  bytes: Uint8Array;
};

/** Validation and key allocation have no filesystem side effects; reserve the quota next. */
export async function prepareUpload(params: {
  familySlug: string;
  personId: string;
  type: MediaAssetType;
  file: File;
}) {
  const { familySlug, personId, type, file } = params;

  // Validate the destination path and size BEFORE loading the file into memory.
  assertSafeSegment(familySlug, "familySlug");
  assertSafeSegment(personId, "personId");
  if (type !== "photo" && type !== "audio") throw new HttpError(400, "Неизвестный тип медиафайла.");
  assertUploadSizeWithinLimit(file.size, type);

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  assertUploadSizeWithinLimit(bytes.byteLength, type);
  if (bytes.byteLength !== file.size) throw new HttpError(400, "Размер файла изменился во время загрузки.");
  const detectedMimeType = detectMimeTypeForUpload(bytes, type);

  validateUpload({
    fileSize: file.size,
    type,
    detectedMimeType,
  });

  const extension = getExtension(detectedMimeType);
  const fileName = `${Date.now()}-${randomUUID()}${extension}`;
  return {
    storagePath: `storage/uploads/${familySlug}/${personId}/${type}/${fileName}`,
    size: bytes.byteLength,
    mimeType: detectedMimeType,
    title: Array.from(path.basename((file.name || `${type}-${Date.now()}`).replaceAll("\\", "/")).replace(/[\u0000-\u001f\u007f]/g, "")).slice(0, 240).join(""),
    checksum: createHash("sha256").update(bytes).digest("hex"),
    bytes,
  } satisfies PreparedUpload;
}

// Only allow safe characters in path segments so a crafted slug/personId (e.g.
// "..") can never escape the uploads directory.
const SAFE_SEGMENT = /^[A-Za-z0-9А-Яа-яЁё_-]+$/;

function assertSafeSegment(segment: string, label: string) {
  if (!segment || !SAFE_SEGMENT.test(segment)) {
    throw new HttpError(400, `Недопустимое значение "${label}" для пути хранения.`);
  }

  return segment;
}

export function getMediaStorageRoot() {
  const configured = process.env.MEDIA_STORAGE_ROOT?.trim();
  if (configured && !path.isAbsolute(configured)) throw new Error("MEDIA_STORAGE_ROOT должен быть абсолютным путём.");
  return path.resolve(configured || path.join(process.cwd(), "storage"));
}

function resolvePrivateStoragePath(storagePath: string) {
  const segments = storagePath.replaceAll("\\", "/").split("/");
  if (segments[0] !== "storage" || segments[1] !== "uploads" || segments.length < 3 ||
      segments.slice(2).some((segment) => !/^[A-Za-z0-9А-Яа-яЁё_-][A-Za-z0-9А-Яа-яЁё_.-]*$/.test(segment) || segment.endsWith("."))) {
    throw new Error("Неверный путь к приватному медиафайлу.");
  }
  return path.join(getMediaStorageRoot(), ...segments.slice(1));
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** The volume and its ancestors must be owned by the service, never writable by other users. */
async function verifyDirectoryChain(directory: string, create = false) {
  const root = path.parse(directory).root;
  let current = root;
  for (const segment of directory.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let entry;
    try { entry = await lstat(current); } catch (error) {
      if (!create || !isMissing(error)) throw error;
      try { await mkdir(current, { mode: 0o700 }); } catch (mkdirError) {
        if (!(mkdirError instanceof Error && "code" in mkdirError && mkdirError.code === "EEXIST")) throw mkdirError;
      }
      entry = await lstat(current);
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("Ссылки и не-каталоги в пути хранилища запрещены.");
  }
}

export async function writePreparedUpload(prepared: PreparedUpload) {
  if (prepared.bytes.byteLength !== prepared.size || createHash("sha256").update(prepared.bytes).digest("hex") !== prepared.checksum) {
    throw new Error("Подготовленный файл изменился до записи.");
  }
  const finalPath = resolvePrivateStoragePath(prepared.storagePath);
  await verifyDirectoryChain(path.dirname(finalPath), true);
  const partialPath = `${finalPath}.partial`;
  const handle = await open(partialPath, "wx", 0o600);
  try { await handle.writeFile(prepared.bytes); await handle.sync(); } finally { await handle.close(); }
  // An exclusive hard link publishes complete bytes atomically without replacing an existing key.
  // Both paths are deterministic and retained for durable cleanup if a later operation fails.
  await link(partialPath, finalPath);
  await unlink(partialPath);
}

export async function saveUpload(params: Parameters<typeof prepareUpload>[0]) {
  const prepared = await prepareUpload(params);
  await writePreparedUpload(prepared);
  const { bytes: _bytes, ...stored } = prepared;
  return stored;
}

export async function openUploadByStoragePath(storagePath: string) {
  const absolutePath = resolvePrivateStoragePath(storagePath);
  await verifyDirectoryChain(path.dirname(absolutePath));
  const before = await lstat(absolutePath);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error("Ссылки и не-файлы в хранилище запрещены.");
  const handle = await open(absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const actual = await handle.stat();
    if (!actual.isFile() || actual.dev !== before.dev || actual.ino !== before.ino) throw new Error("Медиафайл изменился во время открытия.");
    return { handle, size: actual.size };
  } catch (error) { await handle.close(); throw error; }
}

export async function statUploadByStoragePath(storagePath: string) {
  const { handle, size } = await openUploadByStoragePath(storagePath);
  await handle.close(); return { size };
}

export async function deleteUploadByStoragePath(storagePath: string) {
  const absolutePath = resolvePrivateStoragePath(storagePath);
  try { await verifyDirectoryChain(path.dirname(absolutePath)); } catch (error) { if (isMissing(error)) return; throw error; }
  for (const target of [`${absolutePath}.partial`, absolutePath]) {
    try {
      const entry = await lstat(target);
      if (entry.isSymbolicLink() || !entry.isFile()) throw new Error("Ссылки и не-файлы в хранилище запрещены.");
      await unlink(target);
    } catch (error) { if (!isMissing(error)) throw error; }
  }
}

export async function readUploadByStoragePath(storagePath: string) {
  const { handle } = await openUploadByStoragePath(storagePath);
  try { return await handle.readFile(); } finally { await handle.close(); }
}

/** Read-only diagnostic inventory, including known .partial files; never deletes unknown keys. */
export async function listStorageKeys() {
  const uploads = path.join(getMediaStorageRoot(), "uploads");
  try { await verifyDirectoryChain(uploads); } catch (error) { if (isMissing(error)) return []; throw error; }
  const keys: string[] = []; let visited = 0;
  async function walk(directory: string, prefix: string) {
    for await (const entry of await opendir(directory)) {
      visited += 1;
      if (visited > 10000) throw new Error("Превышен лимит сверки хранилища (10000 записей). Уменьшите область проверки.");
      if (entry.isSymbolicLink()) throw new Error("Ссылки в хранилище запрещены.");
      const key = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) { await verifyDirectoryChain(path.join(directory, entry.name)); await walk(path.join(directory, entry.name), key); }
      else if (entry.isFile()) keys.push(key);
      else throw new Error("Неизвестный тип записи хранилища.");
    }
  }
  await walk(uploads, "storage/uploads");
  return keys.sort();
}
