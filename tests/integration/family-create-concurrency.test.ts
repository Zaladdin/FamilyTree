import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { Prisma, PrismaClient } from "@prisma/client";
import { HttpError } from "@/lib/http-error";
import { disconnectTestPrisma, withTestUser } from "./helpers";
import { overrideTransaction } from "./transaction-override";

after(disconnectTestPrisma);

function barrier(parties: number) {
  let arrived = 0;
  let release!: () => void;
  let reject!: (error: Error) => void;
  let timer: NodeJS.Timeout | undefined;
  const ready = new Promise<void>((resolve, fail) => { release = resolve; reject = fail; });
  return async () => {
    arrived += 1;
    if (arrived === 1) {
      timer = setTimeout(() => reject(new Error("Parallel quota reads did not meet at the barrier")), 3_000);
    }
    if (arrived >= parties) {
      clearTimeout(timer);
      release();
    }
    await ready;
  };
}

function synchronizeFirstQuotaReads(t: TestContext, prisma: PrismaClient, userId: string) {
  const meet = barrier(2);
  const reads: number[] = [];
  type TransactionOptions = { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number };
  const originalTransaction = prisma.$transaction.bind(prisma) as <T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>, options?: TransactionOptions,
  ) => Promise<T>;
  // Keep genuine PostgreSQL transactions and delegates. Only coordinate the
  // first two completed quota reads so the requests share the same old count.
  const wrappedTransaction = async <T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>, options?: TransactionOptions,
  ) => originalTransaction(async (tx) => {
    const memberships = new Proxy(tx.familyMembership, {
      get(target, property, receiver) {
        if (property !== "count") return Reflect.get(target, property, receiver);
        return async (args: Prisma.FamilyMembershipCountArgs) => {
          const count = await target.count(args);
          if (args.where?.userId === userId && args.where?.role === "owner") {
            assert.equal(typeof count, "number");
            reads.push(count as number);
            if (reads.length <= 2) await meet();
          }
          return count;
        };
      },
    });
    const coordinated = new Proxy(tx, {
      get(target, property, receiver) {
        return property === "familyMembership" ? memberships : Reflect.get(target, property, receiver);
      },
    });
    return operation(coordinated);
  }, options);
  const restore = overrideTransaction(t, prisma, wrappedTransaction as typeof prisma.$transaction);
  return { reads, restore };
}

for (const collideSlugs of [false, true]) {
  test(`parallel creates from nine owned families never exceed ten (${collideSlugs ? "same" : "different"} slug)`, { timeout: 30_000 }, async (t) => {
    await withTestUser(async ({ prisma, user }) => {
      const { createFamilySpace } = await import("@/lib/family-admin-repository");
      const input = { title: "Лимит семей", surname: user.id, region: "Баку", description: "Disposable concurrency fixture" };
      for (let index = 0; index < 9; index += 1) {
        await createFamilySpace({ user, input: { ...input, surname: `${user.id}-existing-${index}` } });
      }
      const coordinated = synchronizeFirstQuotaReads(t, prisma, user.id);
      let results: PromiseSettledResult<{ slug: string }>[];
      try {
        results = await Promise.allSettled([0, 1].map((index) => createFamilySpace({
          user, input: { ...input, surname: `${user.id}-new-${collideSlugs ? 0 : index}` },
        })));
      } finally {
        coordinated.restore();
      }

      assert.deepEqual(coordinated.reads.slice(0, 2), [9, 9]);
      assert.ok(coordinated.reads.includes(10), "the loser must re-read quota after the winner commits");
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      const rejected = results.filter((result) => result.status === "rejected");
      assert.equal(rejected.length, 1);
      assert.ok(rejected[0].reason instanceof HttpError);
      assert.equal(rejected[0].reason.status, 400);
      assert.equal(await prisma.familyMembership.count({ where: { userId: user.id, role: "owner" } }), 10);

      const families = await prisma.family.findMany({
        where: { memberships: { some: { userId: user.id, role: "owner" } } },
        include: { memberships: true, digitizationTasks: true, auditLogs: true },
      });
      assert.equal(families.length, 10);
      for (const family of families) {
        assert.equal(family.memberships.length, 1);
        assert.equal(family.memberships[0].userId, user.id);
        assert.equal(family.memberships[0].role, "owner");
        assert.equal(family.digitizationTasks.length, 2);
        assert.equal(family.auditLogs.length, 1);
        assert.equal(family.auditLogs[0].actorName, `${user.firstName} ${user.lastName}`);
      }
    });
  });
}
