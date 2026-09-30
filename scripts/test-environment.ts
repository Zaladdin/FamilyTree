// A unit test accidentally reaching Prisma must fail without contacting a real DB.
export const UNIT_DATABASE_URL =
  "postgresql://unit:unit@127.0.0.1:1/rodovo_unit_test?connect_timeout=1";

function parseDatabaseUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) {
      throw new Error();
    }
    const database = decodeURIComponent(url.pathname.slice(1));
    if (!database || database.includes("/")) throw new Error();
    return { url, database };
  } catch {
    // Never include URLs or credentials in errors or test output.
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
}

export function assertTestDatabaseUrl(value: string | undefined, primaryUrl?: string) {
  if (!value?.trim()) {
    throw new Error("Integration tests require an explicit TEST_DATABASE_URL; .env is not read.");
  }
  const candidate = parseDatabaseUrl(value);
  if (!/(?:^|[_-])test(?:$|[_-])/i.test(candidate.database)) {
    throw new Error("Integration tests require a separate database named with a test segment, e.g. rodovo_test.");
  }
  if (primaryUrl) {
    const primary = parseDatabaseUrl(primaryUrl);
    const sameDatabase =
      candidate.url.hostname === primary.url.hostname &&
      (candidate.url.port || "5432") === (primary.url.port || "5432") &&
      candidate.database === primary.database;
    if (sameDatabase) {
      throw new Error("TEST_DATABASE_URL must not refer to the current DATABASE_URL database.");
    }
  }
  return candidate.url.toString();
}
