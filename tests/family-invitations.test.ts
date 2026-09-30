import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { HttpError } from "@/lib/http-error";
import type { FamilyRole } from "@/lib/types";
import { UNIT_DATABASE_URL } from "../scripts/test-environment";

type Invite = { id: string; familyId: string; email: string; role: FamilyRole; invitedById: string; tokenHash: string; expiresAt: Date; status: string; acceptedById: string | null; acceptedAt: Date | null; version: number; createdAt: Date };
type Member = { id: string; familyId: string; userId: string; name: string; role: FamilyRole };
type User = { id: string; email: string; emailVerifiedAt: Date | null; firstName: string; lastName: string };
type State = { invitations: Invite[]; memberships: Member[]; users: User[]; count: number; audits: Record<string, unknown>[] };
let state: State;
let attempts = 0;
let beforeCommit: ((draft: State, attempt: number) => void) | undefined;
const owner = { userId: "owner", name: "Владелец" };
const inviteToken = "a".repeat(64);
const previousUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = UNIT_DATABASE_URL;
const globalPrisma = globalThis as { prisma?: unknown };
const previousPrisma = globalPrisma.prisma;
function matches(row: Invite, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "familyId_email") return row.familyId === (value as Invite).familyId && row.email === (value as Invite).email;
    if (key === "expiresAt") return row.expiresAt > (value as { gt: Date }).gt;
    return row[key as keyof Invite] === value;
  });
}
function delegates(draft: State) {
  return {
    family: {
      findUnique: async ({ where }: { where: { slug?: string; id?: string } }) => where.slug === "unit" || where.id === "family" ? { id: "family", title: "Семья", slug: "unit" } : null,
      update: async ({ data }: { data: { contributorsCount: { increment: number } } }) => { draft.count += data.contributorsCount.increment; },
    },
    user: { findUnique: async ({ where }: { where: { id?: string; email?: string } }) => draft.users.find((row) => where.id ? row.id === where.id : row.email === where.email) ?? null },
    familyMembership: {
      findFirst: async ({ where }: { where: { familyId: string; userId: string } }) => draft.memberships.find((row) => row.familyId === where.familyId && row.userId === where.userId) ?? null,
      create: async ({ data }: { data: Omit<Member, "id"> }) => { const row = { ...data, id: "new-membership" }; draft.memberships.push(row); return row; },
    },
    familyInvitation: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) => draft.invitations.find((row) => matches(row, where)) ?? null,
      findFirst: async ({ where }: { where: Record<string, unknown> }) => draft.invitations.find((row) => matches(row, where)) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) => draft.invitations.filter((row) => matches(row, where)),
      create: async ({ data }: { data: Partial<Invite> }) => { const row = { ...sample(), ...data, id: "new-invitation" }; draft.invitations.push(row); return row; },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Omit<Invite, "version">> & { version?: { increment: number } } }) => {
        const row = draft.invitations.find((entry) => matches(entry, where));
        if (!row) return { count: 0 };
        Object.assign(row, data, { version: row.version + (data.version?.increment ?? 0) });
        return { count: 1 };
      },
    },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { draft.audits.push(data); return data; } },
  };
}
const fakePrisma = {
  $transaction: async <T>(run: (tx: ReturnType<typeof delegates>) => Promise<T>, options: unknown) => {
    assert.deepEqual(options, { isolationLevel: "Serializable" });
    attempts += 1;
    const draft = structuredClone(state);
    const result = await run(delegates(draft));
    beforeCommit?.(draft, attempts);
    state = draft;
    return result;
  },
};
globalPrisma.prisma = fakePrisma;
const requireTest = createRequire(path.resolve("tests/family-invitations.test.ts"));
const repository: typeof import("@/lib/family-invitations") = requireTest("../lib/family-invitations");
const tokenHelpers: typeof import("@/lib/auth-token") = requireTest("../lib/auth-token");
function sample(): Invite {
  return { id: "invite", familyId: "family", email: "recipient@example.invalid", role: "member", invitedById: owner.userId, tokenHash: tokenHelpers.hashAuthToken(inviteToken), expiresAt: new Date(Date.now() + 60_000), status: "pending", acceptedAt: null, acceptedById: null, version: 0, createdAt: new Date(0) };
}
beforeEach(() => {
  state = { invitations: [], memberships: [{ id: "owner-membership", familyId: "family", userId: owner.userId, name: owner.name, role: "owner" }], users: [{ id: "recipient", email: "recipient@example.invalid", emailVerifiedAt: new Date(), firstName: "Имя", lastName: "Фамилия" }], count: 1, audits: [] };
  attempts = 0; beforeCommit = undefined;
});
after(() => {
  if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  if (previousPrisma === undefined) delete globalPrisma.prisma; else globalPrisma.prisma = previousPrisma;
});
const fails = (code: number) => (error: unknown) => error instanceof HttpError && error.status === code;
const create = (email = "recipient@example.invalid", role: FamilyRole = "member") => repository.createFamilyInvitation({ slug: "unit", email, role, actor: owner });
const mutation = () => ({ slug: "unit", invitationId: "invite", expectedVersion: 0, actor: owner });
const accept = () => repository.acceptFamilyInvitation({ token: inviteToken, userId: "recipient" });

test("invite existing or unregistered email creates no membership and exposes no token", async () => {
  for (const email of ["recipient@example.invalid", "unknown@example.invalid"]) {
    const result = await create(email);
    assert.equal(result.invitation.email, email);
    assert.equal(result.delivery, "unavailable");
    assert.equal(result.invitation.status, "pending");
    assert.equal(state.memberships.length, 1);
    assert.equal(state.count, 1);
    assert.equal("tokenHash" in result.invitation, false);
    assert.equal("token" in result, false);
  }
  assert.equal(state.audits.length, 2);
});
test("legacy add-by-email entry point creates an invitation without granting rights", async () => {
  const { addFamilyMemberByEmail }: typeof import("@/lib/family-members") = requireTest("../lib/family-members");
  const result = await addFamilyMemberByEmail({ slug: "unit", email: "recipient@example.invalid", role: "editor", actor: owner });
  assert.equal(result.invitation.role, "editor"); assert.equal(state.memberships.length, 1); assert.equal(state.count, 1);
});
test("invitation creation rereads manager demotion after retry and does not send or persist", async () => {
  beforeCommit = (_draft, attempt) => { if (attempt === 1) { state.memberships[0].role = "guest"; throw new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "test" }); } };
  await assert.rejects(create(), fails(403));
  assert.equal(attempts, 2); assert.equal(state.invitations.length, 0); assert.equal(state.count, 1); assert.equal(state.audits.length, 0);
});
test("delivery happens once after a successful commit even when the transaction retries", async () => {
  let deliveries = 0;
  beforeCommit = (_draft, attempt) => { if (attempt === 1) throw new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "test" }); };
  const result = await repository.createFamilyInvitation({ slug: "unit", email: "recipient@example.invalid", role: "member", actor: owner }, async (mail) => {
    deliveries += 1;
    assert.equal(mail.kind, "family_invitation");
    assert.equal(mail.to, "recipient@example.invalid");
    assert.equal(state.invitations[0].tokenHash, tokenHelpers.hashAuthToken(mail.token));
    return true;
  });
  assert.equal(result.delivery, "sent"); assert.equal(attempts, 2); assert.equal(deliveries, 1);
  assert.equal(state.audits.length, 1); assert.equal("token" in result, false);
});
test("normalize email and disallow owner/admin escalation or missing manager", async () => {
  assert.equal((await create("  Recipient@EXAMPLE.invalid  ")).invitation.email, "recipient@example.invalid");
  await assert.rejects(create("new@example.invalid", "owner"), fails(400));
  state.memberships[0].role = "admin";
  await assert.rejects(create("new@example.invalid", "admin"), fails(403));
  state.memberships = [];
  await assert.rejects(create(), fails(403));
});
test("duplicate pending creation cannot rotate a token without explicit versioned resend", async () => {
  state.invitations.push(sample());
  await assert.rejects(create(), fails(409));
  assert.equal(state.invitations[0].version, 0);
});
test("accept requires verified exact current email", async () => {
  state.invitations.push(sample());
  state.users[0].emailVerifiedAt = null;
  await assert.rejects(accept(), fails(403));
  state.users[0].emailVerifiedAt = new Date(); state.users[0].email = "other@example.invalid";
  await assert.rejects(accept(), fails(403));
  assert.equal(state.count, 1); assert.equal(state.audits.length, 0);
});
test("accept is explicit, atomic and idempotent for the same verified recipient", async () => {
  state.invitations.push(sample());
  const first = await accept();
  const repeat = await accept();
  assert.equal(first.alreadyAccepted, false); assert.equal(repeat.alreadyAccepted, true);
  assert.equal(first.membershipId, repeat.membershipId);
  assert.equal(first.slug, "unit"); assert.equal(state.count, 2);
  assert.equal(state.memberships.length, 2); assert.equal(state.audits.length, 1);
  assert.equal(state.invitations[0].status, "accepted");
});
test("accepted token cannot re-add an excluded member", async () => {
  state.invitations.push(sample()); await accept(); state.memberships.pop(); state.count -= 1;
  await assert.rejects(accept(), fails(409));
  assert.equal(state.memberships.length, 1);
});
test("existing membership is never overwritten by acceptance", async () => {
  state.invitations.push({ ...sample(), role: "admin" });
  state.memberships.push({ id: "existing", familyId: "family", userId: "recipient", name: "Имя", role: "guest" }); state.count = 2;
  assert.equal((await accept()).membershipId, "existing");
  assert.equal(state.memberships[1].role, "guest"); assert.equal(state.count, 2); assert.equal(state.audits.length, 0);
});
test("revoked and expired invitations cannot be accepted", async () => {
  state.invitations.push({ ...sample(), status: "revoked" }); await assert.rejects(accept(), fails(410));
  state.invitations[0] = { ...sample(), expiresAt: new Date(0) }; await assert.rejects(accept(), fails(410));
  assert.equal(state.memberships.length, 1);
});
test("accept rechecks inviter authorization including admin assignment", async () => {
  state.invitations.push({ ...sample(), role: "admin" });
  state.memberships[0].role = "admin"; await assert.rejects(accept(), fails(403));
  state.invitations[0].role = "member"; state.memberships[0].role = "editor";
  await assert.rejects(accept(), fails(403));
});
test("role update uses version, current role, and rotates the old token", async () => {
  state.invitations.push(sample());
  const result = await repository.updateFamilyInvitation({ ...mutation(), role: "editor" });
  assert.equal(result.invitation.role, "editor"); assert.equal(result.invitation.version, 1);
  assert.notEqual(state.invitations[0].tokenHash, tokenHelpers.hashAuthToken(inviteToken));
  await assert.rejects(repository.updateFamilyInvitation({ ...mutation(), role: "guest" }), fails(409));
  await assert.rejects(accept(), fails(400));
});
test("revoke prevents acceptance and resend renews revoked token", async () => {
  state.invitations.push(sample());
  const revoked = await repository.revokeFamilyInvitation(mutation());
  assert.equal(revoked.invitation.status, "revoked");
  await assert.rejects(accept(), fails(410));
  const resent = await repository.resendFamilyInvitation({ ...mutation(), expectedVersion: 1 });
  assert.equal(resent.invitation.status, "pending"); assert.equal(resent.invitation.version, 2);
  assert.equal(resent.delivery, "unavailable");
  await assert.rejects(accept(), fails(400));
});
test("admin cannot edit/revoke/resend an admin invitation", async () => {
  state.invitations.push({ ...sample(), role: "admin" }); state.memberships[0].role = "admin";
  await assert.rejects(repository.updateFamilyInvitation({ ...mutation(), role: "member" }), fails(403));
  await assert.rejects(repository.revokeFamilyInvitation(mutation()), fails(403));
  await assert.rejects(repository.resendFamilyInvitation(mutation()), fails(403));
});
test("listing is manager-only and reports elapsed pending rows as expired without leaking hash", async () => {
  state.invitations.push({ ...sample(), expiresAt: new Date(0) });
  const list = await repository.getFamilyInvitations("unit", owner.userId);
  assert.equal(list[0].status, "expired"); assert.equal("tokenHash" in list[0], false);
  state.memberships[0].role = "member";
  await assert.rejects(repository.getFamilyInvitations("unit", owner.userId), fails(403));
});
test("accept retry rereads inviter demotion and rolls back all effects", async () => {
  state.invitations.push(sample());
  beforeCommit = (_draft, attempt) => { if (attempt === 1) { state.memberships[0].role = "guest"; throw new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "test" }); } };
  await assert.rejects(accept(), fails(403));
  assert.equal(attempts, 2); assert.equal(state.count, 1); assert.equal(state.audits.length, 0); assert.equal(state.invitations[0].status, "pending");
});
test("concurrent accept retry returns existing result without duplicate membership/counter/audit", async () => {
  state.invitations.push(sample());
  beforeCommit = (draft, attempt) => { if (attempt === 1) { state = draft; throw new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "test" }); } };
  assert.equal((await accept()).alreadyAccepted, true);
  assert.equal(state.memberships.length, 2); assert.equal(state.count, 2); assert.equal(state.audits.length, 1);
});
