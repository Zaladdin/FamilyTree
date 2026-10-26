import { getCiDatabaseEnvironment } from "./ci-database-environment";

/** Configuration gate only; the runner must verify its database ownership marker before writes. */
export function getArchiveBenchmarkEnvironment(env: Record<string, string | undefined>): Record<string, string | undefined> {
  if (env.RODOVO_ARCHIVE_BENCHMARK !== "disposable") {
    throw new Error("Archive benchmark requires RODOVO_ARCHIVE_BENCHMARK=disposable.");
  }
  const value = env.TEST_DATABASE_URL;
  // URL parsing discards some whitespace/control characters; reject them before normalization.
  if (!value || value.trim() !== value || /[\u0000-\u0020\u007f]/.test(value)) {
    throw new Error("Archive benchmark requires an explicit unambiguous TEST_DATABASE_URL.");
  }
  const ciEnvironment = getCiDatabaseEnvironment(env);
  const url = new URL(ciEnvironment.TEST_DATABASE_URL!);
  const port = Number(url.port);
  if (!url.port || !Number.isSafeInteger(port) || port <= 1024 || port === 5432) {
    throw new Error("Archive benchmark requires an explicit non-default unprivileged loopback port.");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(env.ARCHIVE_BENCHMARK_TOKEN ?? "")) {
    throw new Error("Archive benchmark requires a UUID ownership token.");
  }
  return { ...ciEnvironment, NODE_ENV: "test" };
}
