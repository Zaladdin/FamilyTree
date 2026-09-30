import { PrismaClient } from "@prisma/client";
import { withConnectionTimeout } from "@/lib/database-connection";

const globalForPrisma = globalThis as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: withConnectionTimeout(process.env.DATABASE_URL),
    // Connector diagnostics may contain SQL, credentials and private values.
    // API boundaries emit only fixed observability categories instead.
    log: [],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
