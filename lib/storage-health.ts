import { constants } from "node:fs";
import { access, lstat, statfs } from "node:fs/promises";
import path from "node:path";
import type { ProbeResult } from "@/lib/health";

export async function inspectStorageHealth(root: string, minimumFree = String(64 * 1024 * 1024)): Promise<ProbeResult> {
  if (!path.isAbsolute(root) || !/^[1-9]\d{0,15}$/.test(minimumFree) || !Number.isSafeInteger(Number(minimumFree))) {
    throw new Error("Некорректная конфигурация проверки хранилища.");
  }
  const resolved = path.resolve(root);
  let current = path.parse(resolved).root;
  for (const segment of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const entry = await lstat(current);
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("Неверный каталог хранилища.");
  }
  await access(resolved, constants.R_OK | constants.W_OK | constants.X_OK);
  const volume = await statfs(resolved, { bigint: true });
  const free = volume.bavail * volume.bsize;
  return { state: free >= BigInt(minimumFree) ? "ok" : "failed", freeBytes: free.toString() };
}
