import { HttpError } from "@/lib/http-error";

type Bucket = {
  count: number;
  resetAt: number;
};

type HitResult = {
  allowed: boolean;
  retryAfterMs: number;
};

// --- In-memory fixed-window store (default, single instance) -----------------

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < 60_000) {
    return;
  }

  lastSweep = now;

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

function hitInMemory(key: string, limit: number, windowMs: number): HitResult {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

// --- Optional Redis store (shared across instances) --------------------------
// ioredis is an optional dependency, loaded only when REDIS_URL is set. The
// module specifier is hidden from the bundler so builds don't require it.

let redisClientPromise: Promise<unknown> | null = null;

function getRedisClient(): Promise<unknown> | null {
  const url = process.env.REDIS_URL;

  if (!url) {
    return null;
  }

  if (!redisClientPromise) {
    const importDynamic = new Function("specifier", "return import(specifier);") as (
      specifier: string,
    ) => Promise<{ default?: unknown }>;

    redisClientPromise = importDynamic("ioredis").then((mod) => {
      const RedisCtor = (mod.default ?? mod) as new (connection: string) => unknown;
      return new RedisCtor(url);
    });
  }

  return redisClientPromise;
}

async function hitRedis(
  client: {
    incr(key: string): Promise<number>;
    pexpire(key: string, ms: number): Promise<number>;
    pttl(key: string): Promise<number>;
  },
  key: string,
  limit: number,
  windowMs: number,
): Promise<HitResult> {
  const redisKey = `ratelimit:${key}`;
  const count = await client.incr(redisKey);

  if (count === 1) {
    await client.pexpire(redisKey, windowMs);
  }

  if (count > limit) {
    const ttl = await client.pttl(redisKey);
    return { allowed: false, retryAfterMs: ttl > 0 ? ttl : windowMs };
  }

  return { allowed: true, retryAfterMs: 0 };
}

// --- Public API --------------------------------------------------------------

export type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
  message?: string;
};

export async function enforceRateLimit({
  key,
  limit,
  windowMs,
  message = "Слишком много попыток. Попробуйте позже.",
}: RateLimitOptions): Promise<void> {
  let result: HitResult;
  const redis = getRedisClient();

  if (redis) {
    try {
      const client = (await redis) as Parameters<typeof hitRedis>[0];
      result = await hitRedis(client, key, limit, windowMs);
    } catch {
      // If Redis is unreachable, fall back to in-memory rather than locking users out.
      result = hitInMemory(key, limit, windowMs);
    }
  } else {
    result = hitInMemory(key, limit, windowMs);
  }

  if (!result.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    throw new HttpError(429, `${message} (через ${retryAfterSeconds} с)`);
  }
}

// Forwarded headers (x-forwarded-for, etc.) are set by the client and can be
// spoofed unless a trusted reverse proxy overwrites them. Only read them when
// the deployment explicitly opts in via TRUST_PROXY_HEADERS. Without a trusted
// proxy the client IP is unknown (null) — callers must not collapse all
// clients into one small shared bucket, or a single attacker could lock
// everyone out; use a per-target key (e.g. email) plus a wide global backstop.
const TRUST_PROXY_HEADERS =
  process.env.TRUST_PROXY_HEADERS === "true" ||
  process.env.TRUST_PROXY_HEADERS === "1";

export function getClientIp(request: Request): string | null {
  if (!TRUST_PROXY_HEADERS) {
    return null;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();

    if (first) {
      return first;
    }
  }

  return (
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    null
  );
}
