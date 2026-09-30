import test, { after, type TestContext } from "node:test";
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
const unexpected = async (..._args: unknown[]): Promise<never> => {
  throw new Error("Unexpected database call in family-create unit test");
};
const prisma = {
  family: { findUnique: unexpected, create: unexpected },
  familyMembership: { count: unexpected },
  $transaction: unexpected,
};
globalPrisma.prisma = prisma;
after(() => {
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  if (previousPrisma === undefined) delete globalPrisma.prisma;
  else globalPrisma.prisma = previousPrisma;
});
const requireTest = createRequire(path.resolve("tests/family-create-concurrency.test.ts"));
assert.equal(requireTest("../lib/prisma").prisma, prisma);
const { createFamilySpace }: typeof import("../lib/family-admin-repository") = requireTest("../lib/family-admin-repository");

const params = {
  user: { id: "unit-owner", firstName: "Тест", lastName: "Создатель" },
  input: { title: "Семья теста", surname: "Test", region: "Баку", description: "Unit fixture" },
};
type FamilyWrite = {
  id: string; slug: string; contributorsCount: number;
  memberships: { create: { userId: string; name: string; role: string } };
  auditLogs: { create: { action: string; actorName: string; message: string } };
  digitizationTasks: { create: { title: string; owner: string; status: string }[] };
};
function conflict(code: "P2002" | "P2034") {
  return new Prisma.PrismaClientKnownRequestError("Synthetic conflict", { code, clientVersion: "unit" });
}
function database(t: TestContext, options: {
  count?: number;
  failCommit?: (state: { count: number; slugs: Set<string> }, attempt: number, pending: FamilyWrite[]) => Error | undefined;
} = {}) {
  const state = {
    count: options.count ?? 9, slugs: new Set<string>(), attempts: 0, directCreates: 0,
    events: [] as string[], committed: [] as FamilyWrite[], countReads: [] as number[],
  };
  const count = async (where: { where: { userId: string; role: string } }, scope: string, value: number) => {
    assert.deepEqual(where, { where: { userId: params.user.id, role: "owner" } });
    state.events.push(`${scope}:count`);
    state.countReads.push(value);
    return value;
  };
  const find = async ({ where }: { where: { slug: string } }, scope: string, slugs: Set<string>) => {
    state.events.push(`${scope}:slug`);
    return slugs.has(where.slug) ? { id: `family-${where.slug}` } : null;
  };
  const commit = (pending: FamilyWrite[], attempt: number) => {
    const failure = options.failCommit?.(state, attempt, pending);
    if (failure) throw failure;
    state.committed.push(...pending);
    state.count += pending.length;
    for (const family of pending) state.slugs.add(family.slug);
  };
  // These legacy paths let RED reproduce the old behavior without touching a DB.
  t.mock.method(prisma.familyMembership, "count", (args: { where: { userId: string; role: string } }) => count(args, "outside", state.count));
  t.mock.method(prisma.family, "findUnique", (args: { where: { slug: string } }) => find(args, "outside", state.slugs));
  t.mock.method(prisma.family, "create", async ({ data }: { data: FamilyWrite }) => {
    state.directCreates += 1;
    state.events.push("outside:create");
    commit([data], state.directCreates);
    return { slug: data.slug };
  });
  t.mock.method(prisma, "$transaction", async (
    run: (tx: unknown) => Promise<unknown>, settings: { isolationLevel: string },
  ) => {
    assert.equal(settings.isolationLevel, "Serializable");
    state.attempts += 1;
    state.events.push("begin");
    const snapshotCount = state.count;
    const snapshotSlugs = new Set(state.slugs);
    const pending: FamilyWrite[] = [];
    const tx = {
      familyMembership: { count: (args: { where: { userId: string; role: string } }) => count(args, "tx", snapshotCount) },
      family: {
        findUnique: (args: { where: { slug: string } }) => find(args, "tx", snapshotSlugs),
        create: async ({ data }: { data: FamilyWrite }) => {
          state.events.push("tx:create");
          pending.push(data);
          return { slug: data.slug };
        },
      },
    };
    try {
      const result = await run(tx);
      commit(pending, state.attempts);
      state.events.push("commit");
      return result;
    } catch (error) {
      state.events.push("rollback");
      throw error;
    }
  });
  return state;
}

test("family quota, slug, owner, initial tasks and audit are committed in one serializable transaction", async (t) => {
  const state = database(t);
  assert.deepEqual(await createFamilySpace(params), { slug: "test" });
  assert.deepEqual(state.events, ["begin", "tx:count", "tx:slug", "tx:create", "commit"]);
  assert.equal(state.count, 10);
  assert.equal(state.committed.length, 1);
  const family = state.committed[0];
  assert.equal(family.id, "family-test");
  assert.equal(family.contributorsCount, 1);
  assert.deepEqual(family.memberships.create, { userId: params.user.id, name: "Тест Создатель", role: "owner" });
  assert.equal(family.auditLogs.create.actorName, "Тест Создатель");
  assert.match(family.auditLogs.create.message, /создал\(а\).*Семья теста/);
  assert.equal(family.digitizationTasks.create.length, 2);
});

test("the tenth owned family prevents all new writes and retains the quota400 response", async (t) => {
  const state = database(t, { count: 10 });
  await assert.rejects(createFamilySpace(params), (error: unknown) => error instanceof HttpError && error.status === 400);
  assert.deepEqual(state.events, ["begin", "tx:count", "rollback"]);
  assert.deepEqual(state.committed, []);
});

for (const code of ["P2034", "P2002"] as const) {
  test(`${code} retries re-read quota and cannot create an eleventh family after another request wins`, async (t) => {
    const state = database(t, { failCommit: (snapshot, attempt) => {
      if (attempt !== 1) return;
      snapshot.count = 10;
      snapshot.slugs.add("test");
      return conflict(code);
    } });
    await assert.rejects(createFamilySpace(params), (error: unknown) => error instanceof HttpError && error.status === 400);
    assert.deepEqual(state.countReads, [9, 10]);
    assert.equal(state.attempts, 2);
    assert.equal(state.count, 10);
    assert.deepEqual(state.committed, []);
  });

  test(`${code} exhaustion returns a typed409 after three attempts and commits no family or audit`, async (t) => {
    const state = database(t, { failCommit: () => conflict(code) });
    await assert.rejects(createFamilySpace(params), (error: unknown) => error instanceof HttpError && error.status === 409);
    assert.equal(state.attempts, 3);
    assert.deepEqual(state.countReads, [9, 9, 9]);
    assert.equal(state.count, 9);
    assert.deepEqual(state.committed, []);
  });
}

test("slug collisions re-read the fresh slug while retaining exactly one owner and audit", async (t) => {
  const state = database(t, { failCommit: (snapshot, attempt) => {
    if (attempt !== 1) return;
    snapshot.slugs.add("test");
    return conflict("P2002");
  } });
  assert.deepEqual(await createFamilySpace(params), { slug: "test-2" });
  assert.equal(state.attempts, 2);
  assert.deepEqual(state.countReads, [9, 9]);
  assert.equal(state.committed.length, 1);
  assert.equal(state.committed[0].id, "family-test-2");
  assert.equal(state.committed[0].auditLogs.create.actorName, "Тест Создатель");
});

test("ordinary database failures are not retried and roll back the entire family create", async (t) => {
  const failure = new Error("Synthetic storage failure");
  const state = database(t, { failCommit: () => failure });
  await assert.rejects(createFamilySpace(params), (error: unknown) => error === failure);
  assert.equal(state.attempts, 1);
  assert.deepEqual(state.committed, []);
  assert.equal(state.count, 9);
});
