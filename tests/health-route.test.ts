import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";

const previousEnvironment = { DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL, MEDIA_STORAGE_ROOT: process.env.MEDIA_STORAGE_ROOT, OPS_METRICS_TOKEN: process.env.OPS_METRICS_TOKEN };
process.env.DATABASE_URL = UNIT_DATABASE_URL;
process.env.REDIS_URL = "";
const globals = globalThis as { prisma?: unknown };
const previousPrisma = globals.prisma;
let queries = 0;
globals.prisma = { $queryRaw: async () => { queries++; throw new Error("private driver details"); } };
let fixture: string; let parent: string;
before(async () => { parent = await realpath(tmpdir()); fixture = await mkdtemp(path.join(parent, "rodovo-health-routes-")); process.env.MEDIA_STORAGE_ROOT = fixture; });
const requireTest = createRequire(path.resolve("tests/health-route.test.ts"));
const live = requireTest("../app/api/health/live/route");
const ready = requireTest("../app/api/health/ready/route");
const metrics = requireTest("../app/api/ops/metrics/route");
after(async () => {
  for (const [key, value] of Object.entries(previousEnvironment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  if (previousPrisma === undefined) delete globals.prisma; else globals.prisma = previousPrisma;
  const target = await realpath(fixture); assert.equal(path.dirname(target), parent); assert.match(path.basename(target), /^rodovo-health-routes-/);
  await rm(target, { recursive: true, force: true });
});

test("liveness does not probe dependencies and exposes no diagnostics", async () => {
  const response = await live.GET(new Request("http://localhost/api/health/live"));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { status: "alive" });
  assert.match(response.headers.get("x-request-id"), /^[a-f0-9-]{36}$/);
  assert.equal(queries, 0);
});

test("readiness responds controlled 503 with only public status", async () => {
  const response = await ready.GET(new Request("http://localhost/api/health/ready"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "not_ready" });
});

test("metrics rejects absent/wrong/disabled tokens before probing dependencies", async () => {
  const before = queries;
  process.env.OPS_METRICS_TOKEN = "synthetic-monitoring-secret-123456789";
  for (const headers of [{}, { authorization: "Bearer wrong" }] as Record<string, string>[]) {
    const response = await metrics.GET(new Request("http://localhost/api/ops/metrics", { headers }));
    assert.equal(response.status, 404); assert.deepEqual(await response.json(), { error: "Не найдено." });
  }
  delete process.env.OPS_METRICS_TOKEN;
  assert.equal((await metrics.GET(new Request("http://localhost/api/ops/metrics"))).status, 404);
  assert.equal(queries, before);
});

test("authorized metrics expose safe dependency and process snapshots without caching", async () => {
  process.env.OPS_METRICS_TOKEN = "synthetic-monitoring-secret-123456789";
  const response = await metrics.GET(new Request("http://localhost/api/ops/metrics", { headers: { authorization: `Bearer ${process.env.OPS_METRICS_TOKEN}` } }));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json(); assert.equal(body.readiness.ready, false); assert.equal(body.operations.scope, "process");
  assert.doesNotMatch(JSON.stringify(body), /synthetic-monitoring-secret|postgresql:/);
});
