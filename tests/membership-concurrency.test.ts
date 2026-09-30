import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { Prisma } from "@prisma/client";
import type { FamilyRole } from "@/lib/types";
import { HttpError } from "@/lib/http-error";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";

type Membership = { id: string; familyId: string; userId: string; name: string; role: FamilyRole };
type State = { memberships: Membership[]; contributorsCount: number; audits: unknown[] };
const actor = { userId: "actor-user", name: "Тест Администратор" };
const staleActor = { ...actor, role: "admin" as const };
const member = (id: string, userId: string, role: FamilyRole): Membership => ({ id, userId, role, familyId: "family", name: id });
let committed: State;
let stale: State;
let attempts: number;
let isolationLevels: unknown[];
let onCommit: ((state: State, attempt: number) => void) | undefined;
const clone = (state: State): State => structuredClone(state);
const conflict = (code = "P2034") => new Prisma.PrismaClientKnownRequestError("unit conflict", { code, clientVersion: "unit" });

function delegates(read: () => State) {
  return {
    family: {
      findUnique: async ({ where }: { where: { slug?: string } }) => where.slug === "unit" ? { id: "family" } : null,
      update: async ({ data }: { data: { contributorsCount: { increment?: number; decrement?: number } } }) => {
        read().contributorsCount += (data.contributorsCount.increment ?? 0) - (data.contributorsCount.decrement ?? 0);
        return { id: "family" };
      },
    },
    user: { findUnique: async () => ({ id: "new-user", firstName: "Новый", lastName: "Участник" }) },
    familyMembership: {
      findFirst: async ({ where }: { where: { id?: string; familyId?: string; userId?: string } }) => read().memberships.find((entry) => (
        (!where.id || entry.id === where.id) && (!where.familyId || entry.familyId === where.familyId) && (!where.userId || entry.userId === where.userId)
      )) ?? null,
      create: async ({ data }: { data: Omit<Membership, "id"> }) => {
        if (read().memberships.some((entry) => entry.familyId === data.familyId && entry.userId === data.userId)) throw conflict("P2002");
        const created = { ...data, id: "new-membership" };
        read().memberships.push(created);
        return created;
      },
      update: async ({ where, data }: { where: { id: string }; data: { role: FamilyRole } }) => {
        const entry = read().memberships.find((candidate) => candidate.id === where.id);
        if (!entry) throw conflict("P2025");
        entry.role = data.role;
        return entry;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const index = read().memberships.findIndex((entry) => entry.id === where.id);
        if (index < 0) throw conflict("P2025");
        return read().memberships.splice(index, 1)[0];
      },
    },
    auditLog: { create: async ({ data }: { data: unknown }) => { read().audits.push(data); return data; } },
  };
}

const previousUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = UNIT_DATABASE_URL;
const globalPrisma = globalThis as { prisma?: unknown };
const previousPrisma = globalPrisma.prisma;
const fakePrisma = {
  ...delegates(() => stale),
  $transaction: async <T>(operation: (tx: ReturnType<typeof delegates>) => Promise<T>, options?: { isolationLevel?: unknown }) => {
    attempts += 1;
    isolationLevels.push(options?.isolationLevel);
    const draft = clone(committed);
    const result = await operation(delegates(() => draft));
    onCommit?.(draft, attempts);
    committed = draft;
    return result;
  },
};
globalPrisma.prisma = fakePrisma;
const requireTest = createRequire(path.resolve("tests/membership-concurrency.test.ts"));
assert.equal(requireTest("../lib/prisma").prisma, fakePrisma);
const { updateFamilyMemberRole, removeFamilyMember }: typeof import("@/lib/family-members") = requireTest("../lib/family-members");

beforeEach(() => {
  committed = { memberships: [member("actor", actor.userId, "admin"), member("target", "target-user", "member")], contributorsCount: 2, audits: [] };
  stale = clone(committed);
  attempts = 0;
  isolationLevels = [];
  onCommit = undefined;
});
after(() => {
  if (previousPrisma === undefined) delete globalPrisma.prisma;
  else globalPrisma.prisma = previousPrisma;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
});
const status = (expected: number) => (error: unknown) => error instanceof HttpError && error.status === expected;
const update = () => updateFamilyMemberRole({ slug: "unit", membershipId: "target", role: "editor", actor: staleActor });
const remove = () => removeFamilyMember({ slug: "unit", membershipId: "target", actor: staleActor });

test("missing actor identity never selects another user's membership", async () => {
  for (const userId of [undefined, ""]) {
    await assert.rejects(updateFamilyMemberRole({ slug: "unit", membershipId: "target", role: "member", actor: { ...actor, userId } } as Parameters<typeof updateFamilyMemberRole>[0]), status(403));
  }
  assert.equal(committed.audits.length, 0);
  assert.equal(committed.contributorsCount, 2);
});

for (const [name, operation] of [["change role", update], ["remove", remove]] as const) {
  test(`${name} rejects an actor demoted since the route checked access`, async () => {
    committed.memberships[0].role = "guest";
    await assert.rejects(operation(), status(403));
    assert.equal(committed.contributorsCount, 2);
    assert.equal(committed.audits.length, 0);
    assert.equal(committed.memberships[1].role, "member");
  });
  test(`${name} rejects an actor removed since the route checked access`, async () => {
    committed.memberships.shift();
    await assert.rejects(operation(), status(403));
    assert.equal(committed.audits.length, 0);
  });
}

for (const [name, operation] of [["change role", update], ["remove", remove]] as const) {
  test(`${name} rereads a target promoted to admin before transaction starts`, async () => {
    committed.memberships[1].role = "admin";
    await assert.rejects(operation(), status(403));
    assert.equal(committed.memberships[1].role, "admin");
    assert.equal(committed.audits.length, 0);
  });
  test(`${name} rechecks target authorization after a serialization conflict`, async () => {
    onCommit = (_draft, attempt) => {
      if (attempt === 1) {
        committed.memberships[1].role = "admin";
        throw conflict();
      }
    };
    await assert.rejects(operation(), status(403));
    assert.equal(attempts, 2);
    assert.deepEqual(isolationLevels, ["Serializable", "Serializable"]);
    assert.equal(committed.memberships[1].role, "admin");
    assert.equal(committed.contributorsCount, 2);
    assert.equal(committed.audits.length, 0);
  });
}

test("removal retry commits one decrement and one audit record", async () => {
  onCommit = (_draft, attempt) => { if (attempt === 1) throw conflict(); };
  await remove();
  assert.equal(attempts, 2);
  assert.equal(committed.contributorsCount, 1);
  assert.equal(committed.audits.length, 1);
  assert.deepEqual(committed.memberships.map(({ id }) => id), ["actor"]);
});

test("removal retry returns 404 if another request already removed the target", async () => {
  onCommit = (_draft, attempt) => {
    if (attempt === 1) {
      committed.memberships.pop();
      committed.contributorsCount -= 1;
      throw conflict();
    }
  };
  await assert.rejects(remove(), status(404));
  assert.equal(attempts, 2);
  assert.equal(committed.contributorsCount, 1);
  assert.equal(committed.audits.length, 0);
});

test("owner role cannot be assigned even through a direct repository call", async () => {
  committed.memberships[0].role = "owner";
  await assert.rejects(updateFamilyMemberRole({ slug: "unit", membershipId: "target", role: "owner", actor: { ...actor, role: "owner" } } as Parameters<typeof updateFamilyMemberRole>[0]), status(400));
  assert.equal(committed.memberships.length, 2);
  assert.equal(committed.audits.length, 0);
});

test("owner can change a different admin while admin cannot appoint another admin", async () => {
  committed.memberships[0].role = "owner";
  committed.memberships[1].role = "admin";
  await update();
  assert.equal(committed.memberships[1].role, "editor");
  committed.memberships[0].role = "admin";
  await assert.rejects(updateFamilyMemberRole({ slug: "unit", membershipId: "target", role: "admin", actor: staleActor }), status(403));
  assert.equal(committed.audits.length, 1);
});

test("non-owner can leave and cannot change their own role", async () => {
  committed.memberships[0].role = "guest";
  await assert.rejects(updateFamilyMemberRole({ slug: "unit", membershipId: "actor", role: "editor", actor: staleActor }), status(403));
  const result = await removeFamilyMember({ slug: "unit", membershipId: "actor", actor: staleActor });
  assert.equal(result.isSelf, true);
  assert.equal(committed.contributorsCount, 1);
  assert.equal(committed.audits.length, 1);
});

test("owner cannot leave or be removed", async () => {
  committed.memberships[0].role = "owner";
  await assert.rejects(removeFamilyMember({ slug: "unit", membershipId: "actor", actor: staleActor }), status(403));
  committed.memberships[1].role = "owner";
  await assert.rejects(remove(), status(403));
  assert.equal(committed.audits.length, 0);
});

test("unchanged role returns without duplicate audit but still verifies fresh permissions", async () => {
  committed.memberships[1].role = "editor";
  await update();
  assert.equal(committed.audits.length, 0);
  committed.memberships[0].role = "member";
  await assert.rejects(update(), status(403));
});
