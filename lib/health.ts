import { createHash, timingSafeEqual } from "node:crypto";

type Dependency = "database" | "storage" | "redis";
export type ProbeResult = { state: "ok" | "disabled" | "failed"; freeBytes?: string };
type Probe = () => Promise<ProbeResult>;
type Check = { state: "ok" | "disabled" | "failed" | "timeout"; durationMs: number; freeBytes?: string };
export type Readiness = { ready: boolean; checkedAt: string; checks: Record<Dependency, Check> };

/** A timeout limits the response, not the underlying I/O. Retain its promise until
 * settlement so repeated health requests cannot accumulate stalled operations. */
function boundedProbe(probe: Probe, timeoutMs: number) {
  let pending: Promise<Check> | undefined;
  return async (): Promise<Check> => {
    const start = performance.now();
    if (!pending) {
      pending = Promise.resolve().then(probe).then((value): Check => ({
        state: value.state,
        durationMs: Math.max(0, Math.round(performance.now() - start)),
        ...(value.freeBytes && /^\d{1,30}$/.test(value.freeBytes) ? { freeBytes: value.freeBytes } : {}),
      }), (): Check => ({ state: "failed", durationMs: Math.max(0, Math.round(performance.now() - start)) }));
      const active = pending;
      void active.then(() => { if (pending === active) pending = undefined; });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([pending, new Promise<Check>((resolve) => {
        timer = setTimeout(() => resolve({ state: "timeout", durationMs: timeoutMs }), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  };
}

export function createReadinessMonitor(
  probes: Record<Dependency, Probe>,
  options: { timeoutMs?: number; cacheMs?: number; onTransition?: (ready: boolean) => void } = {},
) {
  const timeoutMs = options.timeoutMs ?? 1000;
  const cacheMs = options.cacheMs ?? 5000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000 ||
      !Number.isSafeInteger(cacheMs) || cacheMs < 0 || cacheMs > 60_000) throw new Error("Некорректные настройки проверки готовности.");
  const names = ["database", "storage", "redis"] as const;
  const checks = names.map((name) => boundedProbe(probes[name], timeoutMs));
  let cached: Readiness | undefined;
  let expiresAt = 0;
  let inFlight: Promise<Readiness> | undefined;
  return async (): Promise<Readiness> => {
    if (cached && Date.now() < expiresAt) return structuredClone(cached);
    if (!inFlight) {
      inFlight = (async () => {
        const [database, storage, redis] = await Promise.all(checks.map((check) => check()));
        const ready = database.state === "ok" && storage.state === "ok" && ["ok", "disabled"].includes(redis.state);
        if ((cached && cached.ready !== ready) || (!cached && !ready)) options.onTransition?.(ready);
        cached = { ready, checkedAt: new Date().toISOString(), checks: { database, storage, redis } };
        expiresAt = Date.now() + cacheMs;
        return cached;
      })();
    }
    const active = inFlight;
    try { return structuredClone(await active); }
    finally { if (inFlight === active) inFlight = undefined; }
  };
}

export function isMetricsAuthorized(header: string | null, configured: string | undefined): boolean {
  if (!configured || !/^[A-Za-z0-9_-]{32,256}$/.test(configured) || !header || header.length > 263) return false;
  const expected = createHash("sha256").update(`Bearer ${configured}`).digest();
  const supplied = createHash("sha256").update(header).digest();
  return timingSafeEqual(expected, supplied);
}
