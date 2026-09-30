import { prisma } from "@/lib/prisma";
import { listStorageKeys, statUploadByStoragePath } from "@/lib/media-storage";

/** Read-only bounded inventory. No unknown file is ever passed to a deletion operation. */
export async function inspectMediaStorage() {
  const assets = await prisma.mediaAsset.findMany({ take: 10_001, select: { storagePath: true, state: true } });
  if (assets.length > 10_000) throw new Error("Media diagnostics inventory limit exceeded.");
  const files = await listStorageKeys();
  const known = new Set<string>();
  let duplicateKeys = 0;
  let missingReady = 0;
  let missingOther = 0;
  for (const asset of assets) {
    const key = asset.storagePath.replaceAll("\\", "/");
    if (known.has(key)) duplicateKeys += 1;
    known.add(key); known.add(`${key}.partial`);
    try { await statUploadByStoragePath(asset.storagePath); }
    catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      if (asset.state === "ready") missingReady += 1; else missingOther += 1;
    }
  }
  return {
    recorded: assets.length, files: files.length, missingReady, missingOther, duplicateKeys,
    partial: files.filter((key) => key.endsWith(".partial")).length,
    orphan: files.filter((key) => !known.has(key.replaceAll("\\", "/"))).length,
  };
}
