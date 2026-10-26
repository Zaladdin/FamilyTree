import assert from "node:assert/strict";
import test from "node:test";
import { hitRedis } from "../lib/rate-limit";

function redisFixture(reply: [number, number]) {
  const calls: unknown[][] = [];
  return {
    calls,
    client: {
      async eval(...args: unknown[]) { calls.push(["eval", ...args]); return reply; },
      // These commands expose the previous split-operation implementation.
      async incr(key: string) { calls.push(["incr", key]); return reply[0]; },
      async pexpire(key: string, ms: number) { calls.push(["pexpire", key, ms]); return 1; },
      async pttl(key: string) { calls.push(["pttl", key]); return -1; },
    },
  };
}

test("Redis rate limiting uses one atomic operation and binds the key and window as arguments", async () => {
  const { calls, client } = redisFixture([1, 10000]);
  assert.deepEqual(await hitRedis(client, "synthetic-atomic", 10, 10000), { allowed: true, retryAfterMs: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "eval");
  assert.deepEqual(calls[0].slice(2), [1, "ratelimit:synthetic-atomic", 10000]);
});

test("atomic Redis script repairs missing expiry independently of the existing count", async () => {
  const { calls, client } = redisFixture([11, 10000]);
  assert.deepEqual(await hitRedis(client, "legacy-no-ttl", 10, 10000), { allowed: false, retryAfterMs: 10000 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "eval");
  const script = calls[0][1] as string;
  assert.match(script, /redis\.call\(['"]INCR['"],\s*KEYS\[1\]\)/i);
  assert.match(script, /redis\.call\(['"]PTTL['"],\s*KEYS\[1\]\)/i);
  assert.match(script, /if ttl < 0 then[\s\S]*redis\.call\(['"]PEXPIRE['"],\s*KEYS\[1\],\s*ARGV\[1\]\)/i);
});

test("blocked Redis requests use the returned remaining window rather than a fresh full window", async () => {
  const { calls, client } = redisFixture([12, 1250]);
  assert.deepEqual(await hitRedis(client, "remaining-window", 10, 10000), { allowed: false, retryAfterMs: 1250 });
  assert.equal(calls.length, 1);
});

test("Redis allows the exact limit and propagates atomic failures to the existing fallback", async () => {
  const { client } = redisFixture([10, 1250]);
  assert.deepEqual(await hitRedis(client, "exact-limit", 10, 10000), { allowed: true, retryAfterMs: 0 });
  const failure = new Error("synthetic Redis failure");
  client.eval = async () => { throw failure; };
  await assert.rejects(hitRedis(client, "failed-atomic", 10, 10000), (error) => error === failure);
});

test("malformed Redis replies cannot silently disable enforcement", async () => {
  for (const reply of [null, [1], [1, -1], [0, 10000], ["12", 10000], [Infinity, 10000]]) {
    const client = { eval: async () => reply };
    await assert.rejects(hitRedis(client, "invalid-reply", 10, 10000), /Invalid Redis rate-limit response/);
  }
});
