import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MediaAssetType } from "@/lib/types";

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
  if (!fileSize) {
    throw new Error("Файл пустой.");
  }

  if (fileSize > maxUploadBytes[type]) {
    throw new Error(
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

  throw new Error(
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
    throw new Error(
      type === "photo"
        ? "Разрешены только изображения JPG, PNG, WebP или GIF."
        : "Разрешены только аудиофайлы MP3, WAV, OGG, WebM или M4A.",
    );
  }
}

export async function saveUpload(params: {
  familySlug: string;
  personId: string;
  type: MediaAssetType;
  file: File;
}) {
  const { familySlug, personId, type, file } = params;

  // Validate the destination path and size BEFORE loading the file into memory.
  const uploadDir = resolveUploadDir(familySlug, personId, type);
  assertUploadSizeWithinLimit(file.size, type);

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const detectedMimeType = detectMimeTypeForUpload(bytes, type);

  validateUpload({
    fileSize: file.size,
    type,
    detectedMimeType,
  });

  await mkdir(uploadDir, { recursive: true });

  const extension = getExtension(detectedMimeType);
  const fileName = `${Date.now()}-${randomUUID()}${extension}`;
  const filePath = path.join(uploadDir, fileName);

  await writeFile(filePath, Buffer.from(arrayBuffer));

  const storagePath = path.relative(process.cwd(), filePath);

  return {
    storagePath,
    size: file.size,
    mimeType: detectedMimeType,
    title: path.basename(file.name || `${type}-${Date.now()}`),
  };
}

// Only allow safe characters in path segments so a crafted slug/personId (e.g.
// "..") can never escape the uploads directory.
const SAFE_SEGMENT = /^[A-Za-z0-9А-Яа-яЁё_-]+$/;

function assertSafeSegment(segment: string, label: string) {
  if (!segment || !SAFE_SEGMENT.test(segment)) {
    throw new Error(`Недопустимое значение "${label}" для пути хранения.`);
  }

  return segment;
}

function resolveUploadDir(familySlug: string, personId: string, type: MediaAssetType) {
  assertSafeSegment(familySlug, "familySlug");
  assertSafeSegment(personId, "personId");
  assertSafeSegment(type, "type");

  const uploadsRoot = path.join(process.cwd(), "storage", "uploads");
  const uploadDir = path.resolve(uploadsRoot, familySlug, personId, type);

  // Belt-and-suspenders: ensure the resolved directory stays inside the root.
  if (uploadDir !== uploadsRoot && !uploadDir.startsWith(uploadsRoot + path.sep)) {
    throw new Error("Неверный путь к каталогу загрузок.");
  }

  return uploadDir;
}

function resolvePrivateStoragePath(storagePath: string) {
  const normalizedStoragePath = storagePath.replace(/[\\/]+/g, path.sep);
  const absoluteStorageRoot = path.join(process.cwd(), "storage");
  const absolutePath = path.resolve(process.cwd(), normalizedStoragePath);

  if (!absolutePath.startsWith(absoluteStorageRoot + path.sep)) {
    throw new Error("Неверный путь к приватному медиафайлу.");
  }

  return absolutePath;
}

export async function deleteUploadByStoragePath(storagePath: string) {
  await rm(resolvePrivateStoragePath(storagePath), { force: true });
}

export async function readUploadByStoragePath(storagePath: string) {
  return readFile(resolvePrivateStoragePath(storagePath));
}
