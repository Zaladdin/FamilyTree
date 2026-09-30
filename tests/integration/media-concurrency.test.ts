import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, User } from "@prisma/client";
import { HttpError } from "@/lib/http-error";
import { disconnectTestPrisma, withTestUser } from "./helpers";
import { overrideTransaction } from "./transaction-override";

after(disconnectTestPrisma);

async function fixture(prisma: PrismaClient, user: User, suffix = "") {
  const { createFamilySpace } = await import("@/lib/family-admin-repository");
  const { slug } = await createFamilySpace({ user, input: { title: `Медиа ${suffix}`, surname: `${user.id}${suffix}`, region: "Баку", description: "Disposable media fixture" } });
  const family = await prisma.family.findUniqueOrThrow({ where: { slug } });
  const person = await prisma.person.create({ data: {
    id: randomUUID(), familyId: family.id, firstName: "Тест", lastName: "Медиа", gender: "male", birthDate: "1980", birthPlace: "Баку", status: "living", biography: "",
  } });
  return { familyId: family.id, params: { slug, personId: person.id, actorUserId: user.id, actorName: "Тест Редактор" } };
}
function reservation(params: Awaited<ReturnType<typeof fixture>>["params"], size = 12) {
  const id = randomUUID();
  return { ...params, id, type: "photo" as const, title: "Синтетический снимок", storagePath: `storage/uploads/${params.slug}/${params.personId}/photo/${id}.png`, mimeType: "image/png", size, checksum: "a".repeat(64) };
}

/** Force both transactions to read the same global quota snapshot before either inserts. */
function coordinateQuotaReads(t: TestContext, prisma: PrismaClient) {
  let reads = 0;
  let release!: () => void;
  let reject!: (error: Error) => void;
  let timer: NodeJS.Timeout | undefined;
  const barrier = new Promise<void>((resolve, fail) => { release = resolve; reject = fail; });
  const original = prisma.$transaction.bind(prisma) as <T>(run: (tx: Prisma.TransactionClient) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }) => Promise<T>;
  const coordinated = async <T>(run: (tx: Prisma.TransactionClient) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }) => original(async (tx) => {
    const mediaAsset = new Proxy(tx.mediaAsset, { get(target, property, receiver) {
      if (property !== "aggregate") return Reflect.get(target, property, receiver);
      return async (...args: Parameters<typeof tx.mediaAsset.aggregate>) => {
        const result = await tx.mediaAsset.aggregate(...args);
        if (!args[0].where) {
          reads += 1;
          if (reads === 1) timer = setTimeout(() => reject(new Error("Concurrent quota transactions did not reach barrier")), 3000);
          if (reads === 2) { clearTimeout(timer); release(); }
          if (reads <= 2) await barrier;
        }
        return result;
      };
    } });
    return run(new Proxy(tx, { get(target, property, receiver) { return property === "mediaAsset" ? mediaAsset : Reflect.get(target, property, receiver); } }));
  }, options);
  const restore = overrideTransaction(t, prisma, coordinated as typeof prisma.$transaction);
  return () => { clearTimeout(timer); restore(); };
}
async function withQuotaSettings(familyBytes: number, systemBytes: number, run: () => Promise<void>) {
  const beforeFamily = process.env.MEDIA_FAMILY_QUOTA_BYTES;
  const beforeSystem = process.env.MEDIA_SYSTEM_QUOTA_BYTES;
  process.env.MEDIA_FAMILY_QUOTA_BYTES = String(familyBytes); process.env.MEDIA_SYSTEM_QUOTA_BYTES = String(systemBytes);
  try { await run(); } finally {
    if (beforeFamily === undefined) delete process.env.MEDIA_FAMILY_QUOTA_BYTES; else process.env.MEDIA_FAMILY_QUOTA_BYTES = beforeFamily;
    if (beforeSystem === undefined) delete process.env.MEDIA_SYSTEM_QUOTA_BYTES; else process.env.MEDIA_SYSTEM_QUOTA_BYTES = beforeSystem;
  }
}
function assertOneReservation(results: PromiseSettledResult<unknown>[]) {
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  const failure = results.find((item) => item.status === "rejected");
  assert.ok(failure?.status === "rejected" && failure.reason instanceof HttpError && failure.reason.status === 413);
}

test("parallel uploads cannot both reserve the final family quota slot", { timeout: 30_000 }, async (t) => {
  await withTestUser(async ({ prisma, user }) => {
    const { reserveMediaUpload } = await import("@/lib/family-media-repository");
    const { params, familyId } = await fixture(prisma, user);
    await withQuotaSettings(12, 10 * 1024 ** 3, async () => {
      const restore = coordinateQuotaReads(t, prisma);
      let results: PromiseSettledResult<unknown>[];
      try { results = await Promise.allSettled([reserveMediaUpload(reservation(params)), reserveMediaUpload(reservation(params))]); }
      finally { restore(); }
      assertOneReservation(results);
      const usage = await prisma.mediaAsset.aggregate({ where: { person: { familyId } }, _sum: { size: true } });
      assert.equal(usage._sum.size, 12);
      assert.equal(await prisma.auditLog.count({ where: { familyId, action: "media_added" } }), 0);
    });
  });
});

test("uploads in different families cannot exceed the global quota together", { timeout: 30_000 }, async (t) => {
  await withTestUser(async ({ prisma, user }) => {
    const { reserveMediaUpload } = await import("@/lib/family-media-repository");
    const first = await fixture(prisma, user, "-one"); const second = await fixture(prisma, user, "-two");
    const baseline = (await prisma.mediaAsset.aggregate({ _sum: { size: true } }))._sum.size ?? 0;
    await withQuotaSettings(1024, baseline + 12, async () => {
      const restore = coordinateQuotaReads(t, prisma);
      let results: PromiseSettledResult<unknown>[];
      try { results = await Promise.allSettled([reserveMediaUpload(reservation(first.params)), reserveMediaUpload(reservation(second.params))]); }
      finally { restore(); }
      assertOneReservation(results);
      assert.equal((await prisma.mediaAsset.aggregate({ _sum: { size: true } }))._sum.size, baseline + 12);
    });
  });
});

test("media finalization checks changed role and exposes only ready assets with atomic counters", { timeout: 30_000 }, async () => {
  await withTestUser(async ({ prisma, user }) => {
    const { reserveMediaUpload, finalizeMediaUpload, getMediaAssetForFamily } = await import("@/lib/family-media-repository");
    const { familyId, params } = await fixture(prisma, user);
    const input = reservation(params);
    await reserveMediaUpload(input);
    await assert.rejects(getMediaAssetForFamily({ ...params, assetId: input.id }), (error: unknown) => error instanceof HttpError && error.status === 404);
    await prisma.familyMembership.updateMany({ where: { familyId, userId: user.id }, data: { role: "member" } });
    try {
      await assert.rejects(finalizeMediaUpload({ ...params, assetId: input.id }), (error: unknown) => error instanceof HttpError && error.status === 403);
    } finally {
      // Restore this fixture user's owner role so the shared helper can remove its own family.
      await prisma.familyMembership.updateMany({ where: { familyId, userId: user.id }, data: { role: "owner" } });
    }
    await finalizeMediaUpload({ ...params, assetId: input.id });
    assert.equal((await getMediaAssetForFamily({ ...params, assetId: input.id })).id, input.id);
    assert.equal((await prisma.family.findUniqueOrThrow({ where: { id: familyId } })).photosCount, 1);
    assert.equal((await prisma.person.findUniqueOrThrow({ where: { id: params.personId } })).photosCount, 1);
    assert.equal(await prisma.auditLog.count({ where: { familyId, action: "media_added" } }), 1);
  });
});
