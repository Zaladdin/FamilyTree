import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";

const previousUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = UNIT_DATABASE_URL;
const globalPrisma = globalThis as { prisma?: unknown };
const previousPrisma = globalPrisma.prisma;
const unexpected = async (..._args: unknown[]): Promise<unknown> => { throw new Error("Unexpected database access"); };
const prisma = { $transaction: unexpected, mediaAsset: { findFirst: unexpected, findMany: unexpected, count: unexpected } };
globalPrisma.prisma = prisma;
const requireTest = createRequire(path.resolve("tests/family-media-lifecycle.test.ts"));
const storageModuleId = requireTest.resolve("../lib/media-storage");
const originalStorage: typeof import("../lib/media-storage") = requireTest(storageModuleId);
const storage = { ...originalStorage, prepareUpload: unexpected, writePreparedUpload: unexpected, deleteUploadByStoragePath: unexpected };
requireTest.cache[storageModuleId]!.exports = storage;
after(() => {
  if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  if (previousPrisma === undefined) delete globalPrisma.prisma; else globalPrisma.prisma = previousPrisma;
  requireTest.cache[storageModuleId]!.exports = originalStorage;
});

type Row = {
  id: string; personId: string; type: "photo" | "audio"; title: string; storagePath: string;
  mimeType: string; size: number; checksum: string | null; state: "pending" | "ready" | "deleting" | "failed";
  cleanupAttempts: number; lastErrorCode: string | null; cleanupAfter: Date | null;
  cleanupLeaseUntil: Date | null; cleanupLeaseToken: string | null; createdAt: Date; updatedAt: Date;
};
const actor = { slug: "family", personId: "person", actorUserId: "actor", actorName: "Тест Редактор" };
const existing = (state: Row["state"] = "ready"): Row => ({
  id: "asset", personId: "person", type: "photo", title: "Семейный снимок", storagePath: "storage/uploads/family/person/photo/asset.png",
  mimeType: "image/png", size: 12, checksum: "a".repeat(64), state,
  cleanupAttempts: 0, lastErrorCode: null, cleanupAfter: null, cleanupLeaseUntil: null, cleanupLeaseToken: null,
  createdAt: new Date(0), updatedAt: new Date(0),
});
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Record<string, unknown>[]).some((item) => matches(row, item));
    if (key === "AND") return (value as Record<string, unknown>[]).every((item) => matches(row, item));
    if (key === "person") return row.personId !== "foreign-person";
    const actual = row[key as keyof Row];
    if (value && typeof value === "object" && !(value instanceof Date)) {
      const filter = value as { in?: unknown[]; lt?: number; gte?: number; lte?: Date; not?: unknown };
      if (filter.in) return filter.in.includes(actual);
      if (filter.lt !== undefined) return typeof actual === "number" && actual < filter.lt;
      if (filter.gte !== undefined) return typeof actual === "number" && actual >= filter.gte;
      if (filter.lte !== undefined) return actual instanceof Date && actual <= filter.lte;
      if ("not" in filter) return actual !== filter.not;
    }
    return actual instanceof Date && value instanceof Date ? actual.getTime() === value.getTime() : actual === value;
  });
}
function setup(t: TestContext, options: {
  rows?: Row[]; role?: string | null; archived?: boolean; auditFails?: boolean;
  failFinalize?: boolean; commitThenFailFinalize?: boolean; globalUsage?: number; familyUsage?: number;
  writeFails?: boolean; deleteFails?: boolean; revokeAfterWrite?: boolean; failCleanupClaim?: boolean;
} = {}) {
  const state = { rows: options.rows ?? [existing()], audits: [] as Record<string, unknown>[], photosCount: 1, audioCount: 0 };
  const writes: string[] = [];
  const deletes: string[] = [];
  t.mock.method(storage, "prepareUpload", async ({ file }: { file: File }) => ({ ...existing(), size: file.size, bytes: new Uint8Array(file.size) }));
  t.mock.method(storage, "writePreparedUpload", async ({ storagePath }: { storagePath: string }) => {
    assert.ok(state.rows.some((row) => row.storagePath === storagePath && row.state === "pending"));
    writes.push(storagePath);
    if (options.writeFails) throw new Error("Private write error");
    if (options.revokeAfterWrite) options.role = "member";
  });
  t.mock.method(storage, "deleteUploadByStoragePath", async (storagePath: string) => {
    assert.ok(state.rows.some((row) => row.storagePath === storagePath && ["failed", "deleting"].includes(row.state)));
    deletes.push(storagePath);
    if (options.deleteFails) throw Object.assign(new Error("Private filename and filesystem details"), { code: "EACCES" });
  });
  const transaction = t.mock.method(prisma, "$transaction", async (run: (tx: unknown) => Promise<unknown>, settings: unknown) => {
    assert.deepEqual(settings, { isolationLevel: "Serializable" });
    const pending = structuredClone(state);
    let finalizing = false;
    const tx = {
      family: {
        findUnique: async ({ where }: { where: { slug: string } }) => where.slug === "family" ? { id: "family-id" } : null,
        update: async ({ data }: { data: Record<string, number> }) => Object.assign(pending, data),
      },
      familyMembership: { findFirst: async () => options.role === null ? null : { role: options.role ?? "editor" } },
      person: {
        findFirst: async ({ where }: { where: { id: string; familyId: string } }) => where.id === "person" && where.familyId === "family-id" && !options.archived
          ? { id: "person", familyId: "family-id", firstName: "Имя", middleName: "", lastName: "Фамилия" } : null,
        update: async () => ({}),
      },
      mediaAsset: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          const row = pending.rows.find((item) => matches(item, where));
          return row ? { ...row, person: { familyId: "family-id" } } : null;
        },
        aggregate: async ({ where }: { where?: Record<string, unknown> }) => ({ _sum: { size: (where ? options.familyUsage : options.globalUsage) ?? pending.rows.reduce((sum, row) => sum + row.size, 0) } }),
        create: async ({ data }: { data: Partial<Row> }) => {
          const row = { ...existing("pending"), ...data };
          pending.rows.push(row); return row;
        },
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          if (options.failCleanupClaim && data.cleanupLeaseToken) throw new Error("Cleanup database unavailable");
          const rows = pending.rows.filter((row) => matches(row, where));
          for (const row of rows) for (const [key, value] of Object.entries(data)) {
            if (key === "state" && value === "ready") finalizing = true;
            (row as unknown as Record<string, unknown>)[key] = value && typeof value === "object" && "increment" in value
              ? Number(row[key as keyof Row]) + Number(value.increment) : value;
          }
          return { count: rows.length };
        },
        deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
          const before = pending.rows.length;
          pending.rows = pending.rows.filter((row) => !matches(row, where));
          return { count: before - pending.rows.length };
        },
        count: async ({ where }: { where: Record<string, unknown> }) => {
          assert.equal(where.state, "ready");
          return pending.rows.filter((row) => matches(row, where)).length;
        },
      },
      auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => {
        if (options.auditFails) throw new Error("Private infrastructure details");
        pending.audits.push(data); return data;
      } },
    };
    const result = await run(tx);
    if (finalizing && options.failFinalize) throw new Error("Finalize database unavailable");
    Object.assign(state, pending);
    if (finalizing && options.commitThenFailFinalize) throw new Error("Unknown commit result");
    return result;
  });
  t.mock.method(prisma.mediaAsset, "findFirst", async ({ where }: { where: Record<string, unknown> }) => state.rows.find((row) => matches(row, where)) ?? null);
  t.mock.method(prisma.mediaAsset, "findMany", async ({ where, take }: { where: Record<string, unknown>; take: number }) => state.rows.filter((row) => matches(row, where)).slice(0, take));
  t.mock.method(prisma.mediaAsset, "count", async ({ where }: { where: Record<string, unknown> }) => state.rows.filter((row) => matches(row, where)).length);
  return { state, transaction, writes, deletes };
}
function repository(): typeof import("../lib/family-media-repository") { return requireTest("../lib/family-media-repository"); }

test("media reservation charges pending bytes and stores immutable key before any ready counter or audit", async (t) => {
  const { state } = setup(t, { rows: [] });
  const asset = await repository().reserveMediaUpload({ ...actor, ...existing(), id: "reserved" });
  assert.equal(asset.state, "pending"); assert.equal(state.rows[0].storagePath, existing().storagePath);
  assert.deepEqual(state.audits, []);
});

test("media reservation quota includes pending, failed, deleting and archived-person originals", async (t) => {
  const { state } = setup(t, { familyUsage: 1024 ** 3 - 11 });
  await assert.rejects(repository().reserveMediaUpload({ ...actor, ...existing(), id: "new" }), (error: unknown) => (error as { status: number }).status === 413);
  assert.equal(state.rows.length, 1);
});

test("media reservation enforces a separate system quota", async (t) => {
  setup(t, { familyUsage: 0, globalUsage: 10 * 1024 ** 3 - 11 });
  await assert.rejects(repository().reserveMediaUpload({ ...actor, ...existing(), id: "new" }), (error: unknown) => (error as { status: number }).status === 413);
});

test("media finalize checks fresh membership and leaves pending reservation after revocation", async (t) => {
  const { state } = setup(t, { rows: [existing("pending")], role: "member" });
  await assert.rejects(repository().finalizeMediaUpload({ ...actor, assetId: "asset" }), (error: unknown) => (error as { status: number }).status === 403);
  assert.equal(state.rows[0].state, "pending"); assert.deepEqual(state.audits, []);
});

test("media finalize atomically exposes one ready asset with one counter and audit", async (t) => {
  const { state } = setup(t, { rows: [existing("pending")] });
  const result = await repository().finalizeMediaUpload({ ...actor, assetId: "asset" });
  assert.equal(result.id, "asset"); assert.equal(state.rows[0].state, "ready");
  assert.equal(state.photosCount, 1); assert.deepEqual(state.audits.map((entry) => entry.action), ["media_added"]);
  await assert.rejects(repository().finalizeMediaUpload({ ...actor, assetId: "asset" }), (error: unknown) => (error as { status: number }).status === 409);
  assert.equal(state.audits.length, 1);
});

test("media finalize rolls back visible state when audit fails", async (t) => {
  const { state } = setup(t, { rows: [existing("pending")], auditFails: true });
  await assert.rejects(repository().finalizeMediaUpload({ ...actor, assetId: "asset" }), /Private infrastructure/);
  assert.equal(state.rows[0].state, "pending"); assert.deepEqual(state.audits, []);
});

test("media read returns only ready assets scoped to the requested family and person", async (t) => {
  setup(t, { rows: [existing("failed")] });
  await assert.rejects(repository().getMediaAssetForFamily({ ...actor, assetId: "asset" }), (error: unknown) => (error as { status: number }).status === 404);
});

test("live maintenance never claims pending uploads even when old", async (t) => {
  const { state } = setup(t, { rows: [existing("pending")] });
  const result = await repository().runMediaMaintenance({ dryRun: false, writersStopped: false, limit: 10 });
  assert.equal(result.processed, 0); assert.equal(state.rows[0].state, "pending");
});

const file = () => new File([new Uint8Array(12)], "photo.png", { type: "image/png" });

test("upload reserves before filesystem write and returns a private URL without storage fields", async (t) => {
  const { state, writes } = setup(t, { rows: [] });
  const asset = await repository().uploadMediaAssetForPerson({ ...actor, type: "photo", file: file() });
  assert.equal(writes.length, 1); assert.equal(state.rows[0].state, "ready");
  assert.match(asset.url, /^\/api\/family\/family\/people\/person\/media\//);
  assert.equal("storagePath" in asset, false); assert.equal("checksum" in asset, false);
});

test("filesystem write and compensation failure retains charged durable asset and sanitized audit", async (t) => {
  const { state } = setup(t, { rows: [], writeFails: true, deleteFails: true });
  await assert.rejects(repository().uploadMediaAssetForPerson({ ...actor, type: "photo", file: file() }), /Private write/);
  assert.equal(state.rows.length, 1); assert.equal(state.rows[0].state, "failed"); assert.equal(state.rows[0].size, 12);
  assert.equal(state.rows[0].cleanupAttempts, 1); assert.equal(state.rows[0].lastErrorCode, "EACCES");
  assert.deepEqual(state.audits.map((entry) => entry.action), ["media_cleanup_failed"]);
  assert.doesNotMatch(JSON.stringify(state.audits), /Private|storage\/|asset\.png/);
});

test("database finalize failure preserves a cleanup record if filesystem compensation also fails", async (t) => {
  const { state } = setup(t, { rows: [], failFinalize: true, deleteFails: true });
  await assert.rejects(repository().uploadMediaAssetForPerson({ ...actor, type: "photo", file: file() }), /Finalize database/);
  assert.equal(state.rows[0].state, "failed"); assert.equal(state.rows[0].size, 12);
  assert.equal(state.audits.some((entry) => entry.action === "media_added"), false);
});

test("lost finalize commit response never deletes a ready file", async (t) => {
  const { state, deletes } = setup(t, { rows: [], commitThenFailFinalize: true });
  await assert.rejects(repository().uploadMediaAssetForPerson({ ...actor, type: "photo", file: file() }), /Unknown commit/);
  assert.equal(state.rows[0].state, "ready"); assert.equal(deletes.length, 0);
  assert.deepEqual(state.audits.map((entry) => entry.action), ["media_added"]);
});

test("revocation during filesystem write prevents publication and cleans up only the pending file", async (t) => {
  const { state, deletes } = setup(t, { rows: [], revokeAfterWrite: true });
  await assert.rejects(repository().uploadMediaAssetForPerson({ ...actor, type: "photo", file: file() }), (error: unknown) => (error as { status: number }).status === 403);
  assert.equal(state.rows.length, 0); assert.equal(deletes.length, 1); assert.equal(state.audits.length, 0);
});

test("deletion hides an asset once, retains quota on filesystem failure, and a later retry releases it", async (t) => {
  const options = { deleteFails: true };
  const { state, deletes } = setup(t, options);
  assert.equal((await repository().deleteMediaAssetFromPerson({ ...actor, assetId: "asset" })).cleanupPending, true);
  assert.equal(state.rows[0].state, "failed"); assert.equal(state.photosCount, 0); assert.equal(state.rows[0].size, 12);
  assert.equal((await repository().deleteMediaAssetFromPerson({ ...actor, assetId: "asset" })).cleanupPending, true);
  assert.equal(deletes.length, 1); assert.equal(state.audits.filter((entry) => entry.action === "media_deleted").length, 1);
  options.deleteFails = false;
  state.rows[0].cleanupAfter = new Date(0);
  const result = await repository().runMediaMaintenance({ dryRun: false });
  assert.equal(result.removed, 1); assert.equal(state.rows.length, 0); assert.equal(state.photosCount, 0);
  assert.equal(state.audits.filter((entry) => entry.action === "media_deleted").length, 1);
});

test("deletion reports queued cleanup even when the cleanup database claim fails after logical commit", async (t) => {
  const { state, deletes } = setup(t, { failCleanupClaim: true });
  const result = await repository().deleteMediaAssetFromPerson({ ...actor, assetId: "asset" });
  assert.equal(result.cleanupPending, true); assert.equal(state.rows[0].state, "deleting"); assert.equal(deletes.length, 0);
});

test("cleanup never deletes ready files, active leases, or reservations with exhausted attempts", async (t) => {
  const rows = [existing(), { ...existing("failed"), id: "leased", cleanupLeaseUntil: new Date(Date.now() + 60_000) }, { ...existing("failed"), id: "exhausted", cleanupAttempts: 5 }];
  const { state, deletes } = setup(t, { rows });
  for (const row of rows) assert.equal(await repository().cleanupMediaAsset(row.id), "deferred");
  assert.equal(state.rows.length, 3); assert.equal(deletes.length, 0);
});

test("offline maintenance can recover pending rows while a dry run never writes or deletes", async (t) => {
  const { state, transaction, deletes } = setup(t, { rows: [existing("pending")] });
  assert.equal((await repository().runMediaMaintenance({ writersStopped: true })).candidates, 1);
  assert.equal(transaction.mock.callCount(), 0); assert.equal(deletes.length, 0);
  const result = await repository().runMediaMaintenance({ writersStopped: true, dryRun: false });
  assert.equal(result.removed, 1); assert.equal(state.rows.length, 0);
});

test("invalid aggregate sizes fail closed without creating another reservation", async (t) => {
  const { state } = setup(t, { familyUsage: Number.NaN });
  await assert.rejects(repository().reserveMediaUpload({ ...actor, ...existing(), id: "new" }));
  assert.equal(state.rows.length, 1);
});

test("only explicit offline recovery can retry an exhausted cleanup, never an active lease", async (t) => {
  const rows = [{ ...existing("failed"), cleanupAttempts: 5 }, { ...existing("failed"), id: "leased", cleanupAttempts: 5, cleanupLeaseUntil: new Date(Date.now() + 60_000) }];
  const { state } = setup(t, { rows });
  const dry = await repository().runMediaMaintenance();
  assert.equal(dry.exhausted, 2); assert.equal(dry.candidates, 0);
  await assert.rejects(repository().runMediaMaintenance({ retryExhausted: true }), /writers/);
  const result = await repository().runMediaMaintenance({ dryRun: false, writersStopped: true, retryExhausted: true });
  assert.equal(result.removed, 1); assert.equal(state.rows.length, 1); assert.equal(state.rows[0].id, "leased");
});
