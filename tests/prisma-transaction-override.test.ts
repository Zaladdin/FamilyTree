import test from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { overrideTransaction } from "./integration/transaction-override";

test("transaction override works with the Prisma proxy and restores the original method", async (t) => {
  const prisma = new PrismaClient({ datasourceUrl: "postgresql://unused:unused@127.0.0.1:1/unused" });
  const original = prisma.$transaction;
  let calls = 0;
  const replacement = (async () => { calls += 1; return "intercepted"; }) as unknown as typeof prisma.$transaction;
  const restore = overrideTransaction(t, prisma, replacement);
  try {
    assert.equal(await prisma.$transaction(async () => "unused"), "intercepted");
    assert.equal(calls, 1);
  } finally {
    restore();
    await prisma.$disconnect();
  }
  assert.equal(prisma.$transaction, original);
  restore();
  assert.equal(prisma.$transaction, original);
});

test("transaction override cleanup restores Prisma after a rejected operation", async () => {
  const prisma = new PrismaClient({ datasourceUrl: "postgresql://unused:unused@127.0.0.1:1/unused" });
  const original = prisma.$transaction;
  let cleanup!: () => void;
  const hooks = { after: (callback: () => void) => { cleanup = callback; } };
  const replacement = (async () => { throw new Error("synthetic failure"); }) as typeof prisma.$transaction;
  overrideTransaction(hooks, prisma, replacement);
  try {
    await assert.rejects(prisma.$transaction(async () => "unused"), /synthetic failure/);
  } finally {
    cleanup();
    await prisma.$disconnect();
  }
  assert.equal(prisma.$transaction, original);
});
