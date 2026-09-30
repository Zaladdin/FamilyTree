import { randomUUID } from "node:crypto";
import { recordOperationalEvent } from "@/lib/observability";
import type { MediaAsset as StoredMedia, Prisma } from "@prisma/client";
import { HttpError } from "@/lib/http-error";
import { prisma } from "@/lib/prisma";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { getMediaQuotas } from "@/lib/media-policy";
import { deleteUploadByStoragePath, prepareUpload, writePreparedUpload } from "@/lib/media-storage";
import type { MediaAssetType } from "@/lib/types";

type MediaActor = { slug: string; personId: string; actorUserId: string; actorName: string };
type MediaScope = { slug: string; personId: string; assetId: string };
type Reservation = MediaActor & {
  id: string; type: MediaAssetType; title: string; storagePath: string;
  mimeType: string; size: number; checksum: string | null;
};
const MAX_CLEANUP_ATTEMPTS = 5;
const CLEANUP_LEASE_MS = 60_000;

async function loadEditor(transaction: Prisma.TransactionClient, params: MediaActor) {
  const family = await transaction.family.findUnique({ where: { slug: params.slug }, select: { id: true } });
  if (!family) throw new HttpError(404, "Семья не найдена.");
  if (!params.actorUserId) throw new HttpError(403, "Недостаточно прав для этого действия.");
  const membership = await transaction.familyMembership.findFirst({
    where: { familyId: family.id, userId: params.actorUserId }, select: { role: true },
  });
  if (!membership || !["owner", "admin", "editor"].includes(membership.role)) {
    throw new HttpError(403, "Недостаточно прав для этого действия.");
  }
  const person = await transaction.person.findFirst({
    where: { id: params.personId, familyId: family.id, isArchived: false },
    select: { id: true, firstName: true, middleName: true, lastName: true },
  });
  if (!person) throw new HttpError(404, "Человек не найден в активном дереве.");
  return { familyId: family.id, personName: [person.firstName, person.middleName, person.lastName].filter(Boolean).join(" ") };
}

function serialize(asset: StoredMedia, slug: string) {
  return {
    id: asset.id, type: asset.type, title: asset.title, mimeType: asset.mimeType,
    size: asset.size, createdAt: asset.createdAt.toISOString(),
    url: `/api/family/${encodeURIComponent(slug)}/people/${encodeURIComponent(asset.personId)}/media/${encodeURIComponent(asset.id)}`,
  };
}

async function updateCountsAndAudit(
  transaction: Prisma.TransactionClient, actor: MediaActor,
  context: { familyId: string; personName: string }, action: "media_added" | "media_deleted",
) {
  const [personPhotos, personAudio, familyPhotos, familyAudio] = await Promise.all([
    transaction.mediaAsset.count({ where: { personId: actor.personId, state: "ready", type: "photo" } }),
    transaction.mediaAsset.count({ where: { personId: actor.personId, state: "ready", type: "audio" } }),
    transaction.mediaAsset.count({ where: { state: "ready", type: "photo", person: { familyId: context.familyId, isArchived: false } } }),
    transaction.mediaAsset.count({ where: { state: "ready", type: "audio", person: { familyId: context.familyId, isArchived: false } } }),
  ]);
  await transaction.person.update({ where: { id: actor.personId }, data: { photosCount: personPhotos, audioCount: personAudio } });
  await transaction.family.update({ where: { id: context.familyId }, data: { photosCount: familyPhotos, audioCount: familyAudio } });
  await transaction.auditLog.create({ data: {
    familyId: context.familyId, personId: actor.personId, personName: context.personName,
    actorName: actor.actorName, action,
    message: `${actor.actorName} ${action === "media_added" ? "добавил(а) медиафайл в карточку" : "удалил(а) медиафайл из карточки"} «${context.personName}».`,
  } });
}

/** All rows remain charged until confirmed physical deletion, including archived people. */
export async function reserveMediaUpload(params: Reservation) {
  if (!Number.isSafeInteger(params.size) || params.size <= 0 || params.size > 20 * 1024 * 1024) {
    throw new HttpError(400, "Некорректный размер медиафайла.");
  }
  const quotas = getMediaQuotas();
  return withSerializableTransaction(async (transaction) => {
    const context = await loadEditor(transaction, params);
    const [familyUsage, systemUsage] = await Promise.all([
      transaction.mediaAsset.aggregate({ where: { person: { familyId: context.familyId } }, _sum: { size: true } }),
      transaction.mediaAsset.aggregate({ _sum: { size: true } }),
    ]);
    for (const usage of [familyUsage._sum.size ?? 0, systemUsage._sum.size ?? 0]) {
      if (!Number.isSafeInteger(usage) || usage < 0) throw new Error("Invalid media quota accounting.");
    }
    if ((familyUsage._sum.size ?? 0) > quotas.familyBytes - params.size) {
      throw new HttpError(413, "В семейном архиве недостаточно места для этого файла.");
    }
    if ((systemUsage._sum.size ?? 0) > quotas.systemBytes - params.size) {
      throw new HttpError(413, "В хранилище недостаточно места для этого файла. Обратитесь к администратору.");
    }
    return transaction.mediaAsset.create({ data: {
      id: params.id, personId: params.personId, type: params.type, title: params.title,
      storagePath: params.storagePath, mimeType: params.mimeType, size: params.size,
      checksum: params.checksum, state: "pending",
    } });
  });
}

export async function finalizeMediaUpload(params: MediaActor & { assetId: string }) {
  return withSerializableTransaction(async (transaction) => {
    const context = await loadEditor(transaction, params);
    const asset = await transaction.mediaAsset.findFirst({ where: { id: params.assetId, personId: params.personId, state: "pending" } });
    if (!asset) throw new HttpError(409, "Состояние загрузки изменилось. Обновите карточку.");
    const changed = await transaction.mediaAsset.updateMany({
      where: { id: asset.id, personId: params.personId, state: "pending" },
      data: { state: "ready", lastErrorCode: null, cleanupAfter: null, updatedAt: new Date() },
    });
    if (changed.count !== 1) throw new HttpError(409, "Состояние загрузки изменилось. Обновите карточку.");
    await updateCountsAndAudit(transaction, params, context, "media_added");
    return serialize(asset, params.slug);
  });
}

/** A lost commit response must never cause a successfully ready file to be removed. */
async function markUploadFailed(assetId: string, code: "UPLOAD_FAILED" | "UPLOAD_INTERRUPTED") {
  return withSerializableTransaction(async (transaction) => {
    const result = await transaction.mediaAsset.updateMany({
      where: { id: assetId, state: "pending" },
      data: { state: "failed", lastErrorCode: code, cleanupAfter: new Date(), updatedAt: new Date() },
    });
    return result.count === 1;
  });
}

export async function uploadMediaAssetForPerson(params: MediaActor & { type: MediaAssetType; file: File }) {
  const prepared = await prepareUpload({ familySlug: params.slug, personId: params.personId, type: params.type, file: params.file });
  const asset = await reserveMediaUpload({ ...params, ...prepared, id: randomUUID() });
  try {
    // Await the writer before changing pending state; live cleanup never claims pending.
    await writePreparedUpload(prepared);
    return await finalizeMediaUpload({ ...params, assetId: asset.id });
  } catch (error) {
    try {
      if (await markUploadFailed(asset.id, "UPLOAD_FAILED")) await cleanupMediaAsset(asset.id);
    } catch {
      // The durable pending/failed row retains its key and charged quota for recovery.
      recordOperationalEvent("upload_recovery_deferred");
    }
    throw error;
  }
}

export async function getMediaAssetForFamily(params: MediaScope) {
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: params.assetId, personId: params.personId, state: "ready", person: { family: { slug: params.slug } } },
    select: { id: true, title: true, mimeType: true, size: true, storagePath: true, checksum: true, type: true },
  });
  if (!asset) throw new HttpError(404, "Медиафайл не найден.");
  return asset;
}

export async function deleteMediaAssetFromPerson(params: MediaActor & { assetId: string }) {
  const asset = await withSerializableTransaction(async (transaction) => {
    const context = await loadEditor(transaction, params);
    const current = await transaction.mediaAsset.findFirst({ where: { id: params.assetId, personId: params.personId } });
    if (!current) throw new HttpError(404, "Медиафайл не найден.");
    if (current.state === "pending") throw new HttpError(409, "Загрузка ещё не завершена.");
    if (current.state === "ready") {
      const changed = await transaction.mediaAsset.updateMany({ where: { id: current.id, state: "ready" }, data: {
        state: "deleting", cleanupAfter: new Date(), lastErrorCode: null, updatedAt: new Date(),
      } });
      if (changed.count !== 1) throw new HttpError(409, "Состояние медиафайла изменилось. Обновите карточку.");
      await updateCountsAndAudit(transaction, params, context, "media_deleted");
    }
    return current;
  });
  try {
    const result = await cleanupMediaAsset(asset.id);
    return { type: asset.type, cleanupPending: result !== "removed" };
  } catch {
    // Logical deletion already committed. Report the durable queued state even
    // when claiming or finishing its physical cleanup cannot reach the database.
    recordOperationalEvent("cleanup_recovery_deferred");
    return { type: asset.type, cleanupPending: true };
  }
}

function cleanupDue(now: Date): Prisma.MediaAssetWhereInput {
  return { state: { in: ["failed", "deleting"] }, cleanupAttempts: { lt: MAX_CLEANUP_ATTEMPTS }, AND: [
    { OR: [{ cleanupAfter: null }, { cleanupAfter: { lte: now } }] },
    { OR: [{ cleanupLeaseUntil: null }, { cleanupLeaseUntil: { lte: now } }] },
  ] };
}

function safeStorageErrorCode(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" && ["EACCES", "EPERM", "EBUSY", "EIO", "ENOSPC"].includes(code) ? code : "STORAGE_DELETE_FAILED";
}

export async function cleanupMediaAsset(assetId: string): Promise<"removed" | "deferred" | "failed"> {
  const now = new Date();
  const leaseToken = randomUUID();
  const asset = await withSerializableTransaction(async (transaction) => {
    const current = await transaction.mediaAsset.findFirst({
      where: { id: assetId, ...cleanupDue(now) }, include: { person: { select: { familyId: true } } },
    });
    if (!current) return null;
    const claimed = await transaction.mediaAsset.updateMany({ where: { id: assetId, ...cleanupDue(now) }, data: {
      cleanupLeaseToken: leaseToken, cleanupLeaseUntil: new Date(now.getTime() + CLEANUP_LEASE_MS),
      cleanupAttempts: { increment: 1 }, updatedAt: now,
    } });
    return claimed.count === 1 ? current : null;
  });
  if (!asset) return "deferred";
  try {
    await deleteUploadByStoragePath(asset.storagePath);
  } catch (error) {
    recordOperationalEvent("cleanup_failed");
    const code = safeStorageErrorCode(error);
    const attempt = asset.cleanupAttempts + 1;
    await withSerializableTransaction(async (transaction) => {
      const changed = await transaction.mediaAsset.updateMany({
        where: { id: asset.id, cleanupLeaseToken: leaseToken, state: { in: ["failed", "deleting"] } }, data: {
          state: "failed", lastErrorCode: code, cleanupLeaseToken: null, cleanupLeaseUntil: null,
          cleanupAfter: new Date(Date.now() + Math.min(60 * 60_000, 60_000 * 2 ** (attempt - 1))), updatedAt: new Date(),
        },
      });
      if (changed.count === 1) await transaction.auditLog.create({ data: {
        familyId: asset.person.familyId, personId: asset.personId, actorName: "Система", action: "media_cleanup_failed",
        message: `Очистка медиафайла отложена. Код: ${code}. Попытка ${attempt} из ${MAX_CLEANUP_ATTEMPTS}.`,
      } });
    });
    return "failed";
  }
  // Only this lease holder releases quota. A crash here leaves a retryable row;
  // deleting an already absent immutable file is safe on the next attempt.
  const released = await withSerializableTransaction(async (transaction) => {
    return transaction.mediaAsset.deleteMany({ where: {
      id: asset.id, cleanupLeaseToken: leaseToken, state: { in: ["failed", "deleting"] },
    } });
  });
  return released.count === 1 ? "removed" : "deferred";
}

export async function runMediaMaintenance(options: { dryRun?: boolean; writersStopped?: boolean; retryExhausted?: boolean; limit?: number } = {}) {
  const { dryRun = true, writersStopped = false, retryExhausted = false, limit = 20 } = options;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Maintenance limit must be between 1 and 100.");
  if (retryExhausted && !writersStopped) throw new Error("Retrying exhausted cleanup requires all writers to be stopped.");
  const now = new Date();
  const due = cleanupDue(now);
  const exhausted: Prisma.MediaAssetWhereInput = { state: { in: ["failed", "deleting"] }, cleanupAttempts: { gte: MAX_CLEANUP_ATTEMPTS } };
  const unlockedExhausted: Prisma.MediaAssetWhereInput = { ...exhausted, OR: [{ cleanupLeaseUntil: null }, { cleanupLeaseUntil: { lte: now } }] };
  const eligible: Prisma.MediaAssetWhereInput[] = [due];
  if (writersStopped) eligible.push({ state: "pending" });
  if (retryExhausted) eligible.push(unlockedExhausted);
  const [rows, exhaustedCount] = await Promise.all([
    prisma.mediaAsset.findMany({ where: { OR: eligible },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit, select: { id: true, state: true, cleanupAttempts: true },
    }),
    prisma.mediaAsset.count({ where: exhausted }),
  ]);
  const result = { dryRun, candidates: rows.length, exhausted: exhaustedCount, processed: 0, removed: 0, deferred: 0, failed: 0 };
  if (dryRun) return result;
  for (const row of rows) {
    try {
      if (row.state === "pending" && !await markUploadFailed(row.id, "UPLOAD_INTERRUPTED")) { result.deferred += 1; continue; }
      if (row.cleanupAttempts >= MAX_CLEANUP_ATTEMPTS) {
        const reset = await withSerializableTransaction((transaction) => transaction.mediaAsset.updateMany({
          where: { id: row.id, ...unlockedExhausted }, data: {
            cleanupAttempts: 0, cleanupLeaseToken: null, cleanupLeaseUntil: null, cleanupAfter: now, updatedAt: now,
          },
        }));
        if (reset.count !== 1) { result.deferred += 1; continue; }
      }
      const outcome = await cleanupMediaAsset(row.id);
      result.processed += 1; result[outcome] += 1;
    } catch {
      result.processed += 1; result.deferred += 1;
      recordOperationalEvent("cleanup_recovery_deferred");
    }
  }
  return result;
}
