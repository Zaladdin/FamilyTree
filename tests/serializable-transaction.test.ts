import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { HttpError } from "@/lib/http-error";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";

const previousUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = UNIT_DATABASE_URL;
const globalPrisma = globalThis as { prisma?: unknown };
const previousPrisma = globalPrisma.prisma;
const prisma = { $transaction: async (..._args: unknown[]): Promise<unknown> => { throw new Error("Unexpected database call"); } };
globalPrisma.prisma = prisma;
after(() => {
  if (previousPrisma === undefined) delete globalPrisma.prisma;
  else globalPrisma.prisma = previousPrisma;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
});
const requireTest = createRequire(path.resolve("tests/serializable-transaction.test.ts"));
const { withSerializableTransaction }: typeof import("../lib/serializable-transaction") = requireTest("../lib/serializable-transaction");
const conflict = (code: string) => new Prisma.PrismaClientKnownRequestError("Private synthetic diagnostic", { code, clientVersion: "test" });

test("retries the whole callback on a new serializable transaction after a conflict", async (t) => {
  let attempts = 0;
  const seen: unknown[] = [];
  t.mock.method(prisma, "$transaction", async (run: (tx: object) => Promise<unknown>, options: { isolationLevel: string }) => {
    assert.equal(options.isolationLevel, "Serializable");
    const result = await run({ attempt: ++attempts });
    if (attempts === 1) throw conflict("P2034");
    return result;
  });
  const value = await withSerializableTransaction(async (tx) => { seen.push(tx); return "committed"; });
  assert.equal(value, "committed");
  assert.equal(attempts, 2);
  assert.notEqual(seen[0], seen[1]);
});

test("exhausted conflicts stop after three attempts with a safe 409", async (t) => {
  const call = t.mock.method(prisma, "$transaction", async () => { throw conflict("P2034"); });
  await assert.rejects(withSerializableTransaction(async () => undefined), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 409);
    assert.doesNotMatch(error.message, /Private|diagnostic/);
    return true;
  });
  assert.equal(call.mock.callCount(), 3);
});

test("unique conflicts retry only when explicitly enabled", async (t) => {
  const error = conflict("P2002");
  const call = t.mock.method(prisma, "$transaction", async () => { throw error; });
  await assert.rejects(withSerializableTransaction(async () => undefined), (caught) => caught === error);
  assert.equal(call.mock.callCount(), 1);
  await assert.rejects(withSerializableTransaction(async () => undefined, { retryUnique: true }), (caught) => caught instanceof HttpError && caught.status === 409);
  assert.equal(call.mock.callCount(), 4);
});

for (const error of [new HttpError(403, "Нет доступа"), new Error("infrastructure"), conflict("P2003")]) {
  test(`does not retry ${error.message}`, async (t) => {
    const call = t.mock.method(prisma, "$transaction", async () => { throw error; });
    await assert.rejects(withSerializableTransaction(async () => undefined), (caught) => caught === error);
    assert.equal(call.mock.callCount(), 1);
  });
}
