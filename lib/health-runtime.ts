import { createReadinessMonitor } from "@/lib/health";
import { getMediaStorageRoot } from "@/lib/media-storage";
import { inspectStorageHealth } from "@/lib/storage-health";
import { probeRedisHealth } from "@/lib/rate-limit";
import { recordOperationalEvent } from "@/lib/observability";

// No Prisma client or I/O is created for liveness. The database query is a
// constant SELECT 1 and cannot read family records. Each probe is single-flight.
export const getRuntimeReadiness = createReadinessMonitor({
  database: async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$queryRaw`SELECT 1`;
    return { state: "ok" };
  },
  storage: () => inspectStorageHealth(getMediaStorageRoot(), process.env.OPS_MIN_FREE_STORAGE_BYTES),
  redis: async () => {
    const state = await probeRedisHealth();
    return { state: state === "healthy" ? "ok" : state === "disabled" ? "disabled" : "failed" };
  },
}, { onTransition: (ready) => recordOperationalEvent(ready ? "readiness_recovered" : "readiness_degraded") });
