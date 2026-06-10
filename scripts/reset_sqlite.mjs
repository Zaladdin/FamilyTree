import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
const prismaDir = path.join(process.cwd(), "prisma");
const sqliteArtifacts = ["dev.db", "dev.db-journal", "dev.db-shm", "dev.db-wal"];
const sqliteDbPath = path.join(prismaDir, "dev.db");

async function removeArtifacts() {
  await Promise.all(
    sqliteArtifacts.map((fileName) =>
      rm(path.join(prismaDir, fileName), { force: true }),
    ),
  );
}

async function main() {
  await removeArtifacts();
  await writeFile(sqliteDbPath, "");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
