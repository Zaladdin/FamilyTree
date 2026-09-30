import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InvitationManager, InvitationChangeDialog } from "../components/invitation-manager";
import type { InvitationView } from "../lib/family-invitations";

const invitation: InvitationView = { id: "invite-1", email: "relative@example.test", role: "member", status: "pending", createdAt: "2026-09-28T10:00:00.000Z", expiresAt: "2026-10-05T10:00:00.000Z", version: 3 };
const noop = () => {};

test("manager invites any email, distinguishes pending access, and never presents a shareable secret", () => {
  const html = renderToStaticMarkup(createElement(InvitationManager, { slug: "sample", viewerRole: "owner", invitations: [invitation], onRefresh: noop }));
  assert.match(html, /Электронная почта родственника/);
  assert.match(html, /Принятие приглашения/);
  assert.match(html, /Ожидает принятия/);
  assert.match(html, /Отправить снова/);
  assert.doesNotMatch(html, /зарегистрированного родственника|name="token"|#token=/);
});

test("non-managers see no invitations and admins cannot manage administrator invitations", () => {
  assert.equal(renderToStaticMarkup(createElement(InvitationManager, { slug: "sample", viewerRole: "member", invitations: [invitation], onRefresh: noop })), "");
  const html = renderToStaticMarkup(createElement(InvitationManager, { slug: "sample", viewerRole: "admin", invitations: [{ ...invitation, role: "admin" }], onRefresh: noop }));
  assert.doesNotMatch(html, /Изменить роль:|Отозвать приглашение:|Отправить снова:/);
});

test("accepted invites have no mutation controls, expired invites can be revoked or resent", () => {
  const accepted = renderToStaticMarkup(createElement(InvitationManager, { slug: "sample", viewerRole: "owner", invitations: [{ ...invitation, status: "accepted" }], onRefresh: noop }));
  assert.match(accepted, /Принято/);
  assert.doesNotMatch(accepted, /aria-label="(?:Изменить роль:|Отозвать приглашение:|Отправить снова:)/);
  const expired = renderToStaticMarkup(createElement(InvitationManager, { slug: "sample", viewerRole: "owner", invitations: [{ ...invitation, status: "expired" }], onRefresh: noop }));
  assert.match(expired, /aria-label="Отозвать приглашение:/);
  assert.match(expired, /aria-label="Отправить снова:/);
  assert.doesNotMatch(expired, /aria-label="Изменить роль:/);
});

test("invitation role dialog names the recipient and preserves only assignable roles", () => {
  const html = renderToStaticMarkup(createElement(InvitationChangeDialog, { slug: "sample", invitation, viewerRole: "admin", mode: "edit", onClose: noop, onRefresh: noop, onSuccess: noop }));
  assert.match(html, /relative@example.test/);
  assert.match(html, /name="role"/);
  assert.doesNotMatch(html, /value="owner"|value="admin"|name="token"/);
});
