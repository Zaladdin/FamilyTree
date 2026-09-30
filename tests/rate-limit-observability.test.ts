import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

test("optional Redis absent uses memory without degradation alerts", () => {
  const env = { ...process.env };
  delete env.REDIS_URL;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--eval", `
    const { probeRedisHealth, enforceRateLimit } = require('./lib/rate-limit.ts');
    (async () => {
      if (await probeRedisHealth() !== 'disabled') process.exit(2);
      await enforceRateLimit({ key: 'synthetic', limit: 1, windowMs: 10000 });
      try { await enforceRateLimit({ key: 'synthetic', limit: 1, windowMs: 10000 }); process.exit(3); }
      catch (error) { if (error.status !== 429) process.exit(4); }
    })();
  `], { env, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /redis_degraded/);
});

test("unreachable optional Redis is bounded and logs one safe degradation transition", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--eval", `
    const { probeRedisHealth, enforceRateLimit } = require('./lib/rate-limit.ts');
    (async () => {
      if (await probeRedisHealth() !== 'degraded') process.exit(2);
      await enforceRateLimit({ key: 'private-key', limit: 2, windowMs: 10000 });
      if (await probeRedisHealth() !== 'degraded') process.exit(3);
      process.exit(0);
    })();
  `], { env: { ...process.env, REDIS_URL: "redis://synthetic-secret@127.0.0.1:1" }, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-secret|private-key|127\.0\.0\.1|ECONNREFUSED|Unhandled/);
  const events = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.event === "redis_degraded").length, 1);
});
