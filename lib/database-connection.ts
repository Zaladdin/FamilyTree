/** Give sleeping PostgreSQL hosts time to wake up; explicit configuration wins. */
export function withConnectionTimeout(connectionString: string | undefined): string | undefined {
  if (!connectionString) return connectionString;
  try {
    const url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.searchParams.has("connect_timeout")) return connectionString;
    url.searchParams.set("connect_timeout", "20");
    return url.toString();
  } catch {
    // Let Prisma validate malformed configuration without logging credentials.
    return connectionString;
  }
}
