import assert from "node:assert/strict";
import test from "node:test";
import { withObservedRoute, getOperationalSnapshot, recordOperationalEvent, recordRequestFailure, setRedisHealth } from "../lib/observability";

test("request logs exclude private inputs and retain response headers and body", async () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (line: string) => { lines.push(line); };
  try {
    const response = await withObservedRoute("/api/auth/login", async () => new Response("ok", { status: 201, headers: { "set-cookie": "private-cookie", "cache-control": "no-store" } }))(
      new Request("http://localhost/api/auth/login?email=private-person", { headers: { "x-request-id": "injected-secret", authorization: "private-token" } }),
    );
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("set-cookie"), "private-cookie");
    assert.equal(await response.text(), "ok");
    assert.match(response.headers.get("x-request-id")!, /^[a-f0-9-]{36}$/);
    assert.equal(lines.length, 1);
    assert.doesNotMatch(lines[0], /private-|injected-secret/);
    assert.equal(JSON.parse(lines[0]).category, "success");
  } finally { console.log = original; }
});

test("unexpected throw is a generic 500 and counted without raw errors", async () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (line: string) => { lines.push(line); };
  try {
    const before = getOperationalSnapshot().requests.serverErrors;
    const response = await withObservedRoute("/api/auth/login", async () => { throw new Error("postgres://private:secret@host"); })(new Request("http://localhost"));
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /postgres|private|secret/);
    assert.equal(getOperationalSnapshot().requests.serverErrors, before + 1);
    assert.doesNotMatch(lines.join(""), /postgres|private|secret/);
  } finally { console.log = original; }
});

test("handled redirect errors retain status while reporting safe failure category", async () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (line: string) => { lines.push(line); };
  try {
    await withObservedRoute("/api/auth/login", async () => {
      recordRequestFailure(new Error("private"));
      return new Response(null, { status: 303 });
    })(new Request("http://localhost"));
    assert.equal(JSON.parse(lines[0]).category, "unexpected");
    assert.equal(JSON.parse(lines[0]).status, 303);
    setRedisHealth("degraded"); setRedisHealth("degraded"); setRedisHealth("healthy");
    assert.equal(lines.filter((line) => JSON.parse(line).event === "redis_degraded").length, 1);
    recordOperationalEvent("backup_failed");
    assert.ok(getOperationalSnapshot().events.backup_failed > 0);
  } finally { console.log = original; }
});

test("unknown route and event labels cannot leak values or create unbounded dimensions", () => {
  assert.throws(() => withObservedRoute("/api/private-family-secret", async () => new Response()));
  assert.throws(() => recordOperationalEvent("private-secret" as never));
});

test("parallel request events keep independent correlation IDs", async () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (line: string) => { lines.push(line); };
  try {
    const handler = withObservedRoute("/api/auth/login", async (_request: Request, delay: number) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      recordOperationalEvent("cleanup_failed");
      return new Response("ok");
    });
    const responses = await Promise.all([handler(new Request("http://localhost"), 10), handler(new Request("http://localhost"), 0)]);
    assert.notEqual(responses[0].headers.get("x-request-id"), responses[1].headers.get("x-request-id"));
    for (const response of responses) {
      const matching = lines.map((line) => JSON.parse(line)).filter((line) => line.requestId === response.headers.get("x-request-id"));
      assert.equal(matching.length, 2);
      assert.equal(matching[0].event, "cleanup_failed");
      assert.equal(matching[1].kind, "request");
    }
  } finally { console.log = original; }
});

test("server upload errors count exactly once and unavailable logger preserves response", async () => {
  const original = console.log;
  console.log = () => { throw new Error("Synthetic unavailable logger"); };
  try {
    const before = getOperationalSnapshot().events.upload_failed;
    const response = await withObservedRoute("/api/family/[slug]/people/[personId]/media", async () => new Response(null, { status: 500 }))(
      new Request("http://localhost", { method: "POST" }),
    );
    assert.equal(response.status, 500);
    assert.equal(getOperationalSnapshot().events.upload_failed, before + 1);
  } finally { console.log = original; }
});
