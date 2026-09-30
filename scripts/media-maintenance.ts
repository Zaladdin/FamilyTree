import path from "node:path";

export function parseMediaMaintenanceArguments(args: string[]) {
  const allowed = new Set(["--dry-run", "--apply", "--confirm-maintenance", "--confirm-file-deletion", "--writers-stopped", "--retry-exhausted", "--diagnostics"]);
  let limit = 20;
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--limit") {
      const value = args[++index];
      if (!value || !/^\d+$/.test(value)) throw new Error("Specify an integer maintenance limit.");
      limit = Number(value);
    } else {
      if (!allowed.has(argument) || flags.has(argument)) throw new Error("Unknown or duplicate maintenance option.");
      flags.add(argument);
    }
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Maintenance limit must be between 1 and 100.");
  if (!flags.has("--confirm-maintenance")) throw new Error("Database and storage access require --confirm-maintenance.");
  if (flags.has("--apply") && flags.has("--dry-run")) throw new Error("Choose --apply or --dry-run.");
  if (flags.has("--apply") !== flags.has("--confirm-file-deletion")) throw new Error("Physical cleanup requires both --apply and --confirm-file-deletion.");
  if (flags.has("--retry-exhausted") && !flags.has("--writers-stopped")) throw new Error("Exhausted retries require --writers-stopped.");
  return {
    dryRun: !flags.has("--apply"), writersStopped: flags.has("--writers-stopped"),
    retryExhausted: flags.has("--retry-exhausted"), diagnostics: flags.has("--diagnostics"), limit,
  };
}

export function assertMediaMaintenanceEnvironment(env: Record<string, string | undefined>) {
  const value = env.MEDIA_MAINTENANCE_DATABASE_URL;
  try {
    if (!value) throw new Error();
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2) throw new Error();
  } catch { throw new Error("An explicit MEDIA_MAINTENANCE_DATABASE_URL is required; .env is not loaded."); }
  if (!env.MEDIA_STORAGE_ROOT || !path.isAbsolute(env.MEDIA_STORAGE_ROOT)) {
    throw new Error("An explicit absolute MEDIA_STORAGE_ROOT is required.");
  }
  return value;
}

async function main() {
  const options = parseMediaMaintenanceArguments(process.argv.slice(2));
  // Never inherit the application's DATABASE_URL or automatically read .env.
  process.env.DATABASE_URL = assertMediaMaintenanceEnvironment(process.env);
  const { prisma } = await import("../lib/prisma");
  try {
    const { runMediaMaintenance } = await import("../lib/family-media-repository");
    const cleanup = await runMediaMaintenance(options);
    const diagnostics = options.diagnostics ? await (await import("../lib/media-storage-diagnostics")).inspectMediaStorage() : undefined;
    console.log(JSON.stringify({ cleanup, ...(diagnostics ? { diagnostics } : {}) }));
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) {
  main().catch(() => {
    // Arguments, DB errors and filesystem exceptions may contain private paths or credentials.
    console.error("Не удалось выполнить обслуживание медиа. Проверьте явно заданную конфигурацию, права доступа и инструкцию обслуживания.");
    process.exitCode = 1;
  });
}
