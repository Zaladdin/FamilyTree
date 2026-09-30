import test from "node:test";
import assert from "node:assert/strict";
import { createReadinessMonitor, isMetricsAuthorized } from "../lib/health";

test("readiness distinguishes healthy dependencies and intentionally disabled Redis", async () => {
  const read = createReadinessMonitor({ database: async () => ({ state: "ok" }), storage: async () => ({ state: "ok", freeBytes: "123456" }), redis: async () => ({ state: "disabled" }) });
  const status = await read();
  assert.equal(status.ready, true);
  assert.equal(status.checks.redis.state, "disabled");
  assert.equal(status.checks.storage.freeBytes, "123456");
});

test("readiness suppresses dependency errors and emits degradation/recovery only on transitions", async () => {
  let failed = true;
  const transitions: boolean[] = [];
  const read = createReadinessMonitor({ database: async () => { if (failed) throw new Error("postgresql://secret and private family story"); return { state: "ok" }; }, storage: async () => ({ state: "ok" }), redis: async () => ({ state: "ok" }) }, { cacheMs: 0, onTransition: (ready) => transitions.push(ready) });
  assert.equal((await read()).ready, false);
  assert.doesNotMatch(JSON.stringify(await read()), /secret|postgresql|family story/);
  failed = false;
  assert.equal((await read()).ready, true);
  await read();
  assert.deepEqual(transitions, [false, true]);
});

test("readiness times out without accumulating overlapping stalled probes and recovers after they settle", async () => {
  let calls = 0;
  let finish!: (value: { state: "ok" }) => void;
  const pending = new Promise<{ state: "ok" }>((resolve) => { finish = resolve; });
  const read = createReadinessMonitor({ database: () => { calls++; return pending; }, storage: async () => ({ state: "ok" }), redis: async () => ({ state: "disabled" }) }, { timeoutMs: 15, cacheMs: 0 });
  const values = await Promise.all(Array.from({ length: 20 }, () => read()));
  assert.equal(calls, 1);
  assert.ok(values.every((value) => value.checks.database.state === "timeout" && !value.ready));
  await read();
  assert.equal(calls, 1);
  finish({ state: "ok" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await read()).ready, true);
});

test("readiness caches results and rejects disabled mandatory dependencies", async () => {
  let calls = 0;
  const read = createReadinessMonitor({ database: async () => { calls++; return { state: "disabled" }; }, storage: async () => ({ state: "ok" }), redis: async () => ({ state: "ok" }) });
  assert.equal((await read()).ready, false);
  await read();
  assert.equal(calls, 1);
});

test("metrics token auth is fail-closed and accepts only the exact configured bearer", () => {
  const token = "synthetic-monitoring-secret-123456789";
  assert.equal(isMetricsAuthorized(`Bearer ${token}`, token), true);
  for (const [header, configured] of [[null, token], [`Bearer ${token}`, undefined], [`Bearer ${token}`, "short"], [token, token], [`Bearer ${token}extra`, token], [`Bearer ${token}`, `${token}\n`]] as const) {
    assert.equal(isMetricsAuthorized(header, configured), false);
  }
});
