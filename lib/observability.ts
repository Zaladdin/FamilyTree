import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { HttpError } from "./http-error";

const routeTemplates = new Set([
  "/api/auth/change-password",
  "/api/auth/forgot-password",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/register",
  "/api/auth/reset-password",
  "/api/auth/sessions/revoke-others",
  "/api/auth/verify-email/confirm",
  "/api/auth/verify-email/request",
  "/api/families",
  "/api/family/[slug]/invitations",
  "/api/family/[slug]/invitations/[invitationId]",
  "/api/family/[slug]/invitations/[invitationId]/resend",
  "/api/family/[slug]/members",
  "/api/family/[slug]/members/[membershipId]",
  "/api/family/[slug]/people",
  "/api/family/[slug]/people/batch",
  "/api/family/[slug]/people/[personId]",
  "/api/family/[slug]/people/[personId]/archive",
  "/api/family/[slug]/people/[personId]/media",
  "/api/family/[slug]/people/[personId]/media/[assetId]",
  "/api/family/[slug]/people/[personId]/relationships",
  "/api/family/[slug]/people/[personId]/relationships/[relationshipId]",
  "/api/family/[slug]/people/[personId]/restore",
  "/api/family/[slug]/people/[personId]/stories",
  "/api/family/[slug]/people/[personId]/stories/[storyId]",
  "/api/family/[slug]/people/[personId]/stories/[storyId]/restore",
  "/api/invitations/accept",
  "/api/health/live",
  "/api/health/ready",
  "/api/ops/metrics"
]);
const eventNames = [
  "upload_failed", "upload_recovery_deferred", "cleanup_failed", "cleanup_recovery_deferred",
  "backup_created", "backup_verified", "backup_restored", "backup_failed",
  "redis_degraded", "redis_recovered", "readiness_degraded", "readiness_recovered",
] as const;
export type OperationalEvent = typeof eventNames[number];
export type RedisHealth = "disabled" | "unknown" | "healthy" | "degraded";
type ErrorCategory = "client" | "database" | "storage" | "unexpected";
type RequestContext = { requestId: string; errorCategory?: ErrorCategory };
function createState() { return {
  startedAt: new Date().toISOString(),
  requests: { total: 0, serverErrors: 0, handledFailures: 0, durationMsTotal: 0, durationMsMax: 0,
    durationBuckets: [50, 100, 250, 500, 1000, 5000].map((upperBoundMs) => ({ upperBoundMs, count: 0 })), durationOverflow: 0 },
  events: Object.fromEntries(eventNames.map((event) => [event, 0])) as Record<OperationalEvent, number>,
  redis: "unknown" as RedisHealth,
}; }
// Share one bounded registry across Next route chunks and development reloads.
const globalOperations = globalThis as typeof globalThis & {
  familyTreeOperations?: { state: ReturnType<typeof createState>; contexts: AsyncLocalStorage<RequestContext> };
};
const registry = globalOperations.familyTreeOperations ??= { state: createState(), contexts: new AsyncLocalStorage<RequestContext>() };
const { state, contexts } = registry;

/** Only fixed fields reach stdout; never pass arbitrary errors, paths or request metadata. */
function emit(fields: Record<string, string | number>) {
  try { console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...fields })); }
  catch { /* Logging must never turn a committed mutation into a failed response. */ }
}

export function recordOperationalEvent(event: OperationalEvent) {
  if (!eventNames.includes(event)) throw new Error("Unknown operational event.");
  state.events[event]++;
  const requestId = contexts.getStore()?.requestId;
  emit({ kind: "operation", event, ...(requestId ? { requestId } : {}) });
}

export function setRedisHealth(health: RedisHealth) {
  if (!["disabled", "unknown", "healthy", "degraded"].includes(health)) throw new Error("Unknown Redis state.");
  if (health === state.redis) return;
  const previous = state.redis;
  state.redis = health;
  if (health === "degraded") recordOperationalEvent("redis_degraded");
  if (health === "healthy" && previous === "degraded") recordOperationalEvent("redis_recovered");
}

export function recordRequestFailure(error: unknown) {
  const context = contexts.getStore();
  if (!context) return;
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  context.errorCategory = error instanceof HttpError && error.status >= 400 && error.status < 500 ? "client"
    : typeof code === "string" && /^P[0-9]{4}$/.test(code) ? "database"
      : typeof code === "string" && ["EACCES", "EPERM", "ENOENT", "EIO", "ENOSPC", "EBUSY"].includes(code) ? "storage"
        : "unexpected";
}

/** In-process counters reset on restart; duration covers the handler, not streamed body consumption. */
export function getOperationalSnapshot() {
  return {
    startedAt: state.startedAt, collectedAt: new Date().toISOString(), scope: "process" as const,
    requests: { ...state.requests, durationBuckets: state.requests.durationBuckets.map((bucket) => ({ ...bucket })) },
    events: { ...state.events }, redis: state.redis,
  };
}

export function withObservedRoute<Args extends unknown[]>(
  routeTemplate: string, handler: (request: Request, ...args: Args) => Promise<Response>,
): (request: Request, ...args: Args) => Promise<Response> {
  if (!routeTemplates.has(routeTemplate)) throw new Error("Unknown route template.");
  return async (request: Request, ...args: Args) => {
    const requestId = randomUUID();
    const started = performance.now();
    const methodValue = request.method;
    const method = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(methodValue) ? methodValue : "OTHER";
    return contexts.run({ requestId }, async () => {
      let response: Response;
      try { response = await handler(request, ...args); }
      catch (error) {
        recordRequestFailure(error);
        response = Response.json({ error: "Не удалось выполнить запрос. Попробуйте позже." }, { status: 500, headers: { "cache-control": "no-store" } });
      }
      const durationMs = Math.max(0, Math.round((performance.now() - started) * 100) / 100);
      const failure = contexts.getStore()?.errorCategory;
      state.requests.total++;
      if (response.status >= 500) state.requests.serverErrors++;
      if (routeTemplate === "/api/family/[slug]/people/[personId]/media" && method === "POST" && response.status >= 500) {
        recordOperationalEvent("upload_failed");
      }
      if (failure) state.requests.handledFailures++;
      state.requests.durationMsTotal += durationMs;
      state.requests.durationMsMax = Math.max(state.requests.durationMsMax, durationMs);
      const bucket = state.requests.durationBuckets.find((entry) => durationMs <= entry.upperBoundMs);
      if (bucket) bucket.count++; else state.requests.durationOverflow++;
      emit({ kind: "request", requestId, route: routeTemplate, method, status: response.status, durationMs,
        category: failure ?? (response.status >= 500 ? "server" : response.status >= 400 ? "client" : "success") });
      // Preserve streaming bodies, cookies and redirects; handlers normally return mutable NextResponse headers.
      try { response.headers.set("x-request-id", requestId); }
      catch {
        const headers = new Headers(response.headers);
        headers.set("x-request-id", requestId);
        response = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      }
      return response;
    });
  };
}
