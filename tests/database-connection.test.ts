import test from "node:test";
import assert from "node:assert/strict";
import { withConnectionTimeout } from "@/lib/database-connection";

test("PostgreSQL connections get a bounded 20 second timeout without changing existing options", () => {
  const original = "postgresql://unit:p%40ss@localhost:5432/unit?sslmode=require&schema=public";
  const result = new URL(withConnectionTimeout(original)!);
  assert.equal(result.searchParams.get("connect_timeout"), "20");
  assert.equal(result.searchParams.get("sslmode"), "require");
  assert.equal(result.password, "p%40ss");
  assert.equal(result.pathname, "/unit");
});

test("explicit timeouts and non-Postgres or missing configuration are preserved", () => {
  for (const original of [undefined, "", "invalid", "file:./dev.db", "prisma://proxy.example/?api_key=unit", "postgres://localhost/unit?connect_timeout=45", "postgres://localhost/unit?connect_timeout=0"]) {
    assert.equal(withConnectionTimeout(original), original);
  }
});
