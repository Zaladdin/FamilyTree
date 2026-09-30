export interface MigrationHistoryRow {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

export function assertMigrationHistory(files: ReadonlyMap<string, string>, rows: readonly MigrationHistoryRow[]) {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.finished_at || row.rolled_back_at || seen.has(row.migration_name) || files.get(row.migration_name) !== row.checksum) {
      throw new Error("Migration history does not match reviewed SQL files; release is blocked.");
    }
    seen.add(row.migration_name);
  }
  if (seen.size !== files.size) throw new Error("Migration history is incomplete; release is blocked.");
}
