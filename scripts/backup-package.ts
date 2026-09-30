import path from "node:path";
import { recordOperationalEvent } from "../lib/observability";
import {
  BackupError, createBackupPackage, inspectBackupInputs, inspectRestoreDestination,
  readBackupMetadataFile, restoreBackupPackage, verifyBackupPackage,
} from "../lib/backup-manifest";

const usage = "Команды: create --dump <absolute> --storage <absolute> --metadata <absolute> --destination <absolute> [--write]; verify --source <absolute>; restore --source <absolute> --destination <absolute> [--write].";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const allowed = command === "create" ? ["dump", "storage", "metadata", "destination", "write"]
    : command === "verify" ? ["source"]
      : command === "restore" ? ["source", "destination", "write"] : undefined;
  if (!allowed) throw new BackupError(usage);
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const key = args[index].startsWith("--") ? args[index].slice(2) : "";
    if (!allowed.includes(key) || options.has(key)) throw new BackupError(usage);
    if (key === "write") options.set(key, "true");
    else {
      const value = args[++index];
      if (!value || !path.isAbsolute(value)) throw new BackupError("Все пути должны быть явными абсолютными путями.");
      options.set(key, value);
    }
  }
  for (const key of allowed.filter((key) => key !== "write")) {
    if (!options.has(key)) throw new BackupError(usage);
  }
  const get = (key: string) => options.get(key)!;
  if (command === "create") {
    const params = { dumpPath: get("dump"), storageSnapshotPath: get("storage"), destination: get("destination"), metadata: await readBackupMetadataFile(get("metadata")) };
    if (!options.has("write")) {
      const inspected = await inspectBackupInputs(params);
      console.log(`План: один готовый дамп и ${inspected.mediaFiles} медиафайлов. Запись не выполнялась. Для создания добавьте --write.`);
      return;
    }
    const manifest = await createBackupPackage(params);
    recordOperationalEvent("backup_created");
    console.log(`Пакет создан и проверен: ${manifest.files.length} файлов. Восстановление PostgreSQL не проверено.`);
    return;
  }
  const manifest = await verifyBackupPackage(get("source"));
  if (command === "verify") {
    recordOperationalEvent("backup_verified");
    console.log(`Целостность пакета подтверждена: ${manifest.files.length} файлов. Восстановление PostgreSQL не проверено.`);
    return;
  }
  if (!options.has("write")) {
    await inspectRestoreDestination(get("source"), get("destination"));
    console.log("План: пакет проверен; будет создан отдельный каталог восстановления. Запись не выполнялась. Добавьте --write.");
    return;
  }
  await restoreBackupPackage({ source: get("source"), destination: get("destination") });
  recordOperationalEvent("backup_restored");
  console.log("Отдельная файловая копия восстановлена и проверена. Восстановление PostgreSQL не проверено; pg_restore не запускался.");
}

void main().catch((error: unknown) => {
  recordOperationalEvent("backup_failed");
  // Filesystem errors can contain private absolute paths; URLs and raw arguments
  // are never printed. This CLI does not import Prisma or load any .env file.
  console.error(error instanceof BackupError ? error.message : "Операция не завершена: проверьте существование файлов, права доступа и свободное место. Незавершённый каталог не использовать.");
  process.exitCode = 1;
});
