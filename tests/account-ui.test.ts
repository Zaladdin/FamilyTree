import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountSettings, ForgotPasswordForm, TokenActionForm } from "@/components/account-forms";
import { readFragmentToken, requestAccountAction } from "@/lib/account-action-request";

test("account links consume only one fragment token, never query-style or ambiguous tokens", () => {
  assert.equal(readFragmentToken("#token=synthetic-only-token"), "synthetic-only-token");
  assert.equal(readFragmentToken("?token=synthetic-only-token"), "");
  assert.equal(readFragmentToken("#token=first&token=second"), "");
  assert.equal(readFragmentToken("#token="), "");
  assert.equal(readFragmentToken("#token=" + "a".repeat(1025)), "");
});

test("forgot password asks only for email and gives non-enumerating guidance", () => {
  const html = renderToStaticMarkup(createElement(ForgotPasswordForm));
  assert.match(html, /autoComplete="email"/);
  assert.match(html, /Отправить ссылку/);
  assert.doesNotMatch(html, /type="password"/);
  assert.match(html, /подтверждён/);
});

test("reset uses two new-password fields and never serializes its token into markup or links", () => {
  const html = renderToStaticMarkup(createElement(TokenActionForm, { kind: "reset", authenticated: false, token: "synthetic-only-token" }));
  assert.equal((html.match(/autoComplete="new-password"/g) ?? []).length, 2);
  assert.match(html, /Повторите новый пароль/);
  assert.doesNotMatch(html, /synthetic-only-token|name="token"/);
  assert.match(html, /<form[^>]*method="post"/);
});

test("anonymous email and invitation links explain reopening after login without forwarding the token", () => {
  for (const kind of ["verify", "invitation"] as const) {
    const html = renderToStaticMarkup(createElement(TokenActionForm, { kind, authenticated: false, token: "synthetic-only-token" }));
    assert.match(html, /снова откройте ссылку из письма/);
    assert.match(html, /href="\/login/);
    assert.match(html, /href="\/register"/);
    assert.doesNotMatch(html, /synthetic-only-token|token=/);
  }
});

test("legacy unverified account keeps access and explains password plus mailbox verification", () => {
  const html = renderToStaticMarkup(createElement(AccountSettings, { email: "synthetic@example.test", firstName: "Тест", lastName: "Семейный", emailVerified: false, legacyAccount: true }));
  assert.match(html, /Доступ к существующим семьям сохраняется/);
  assert.match(html, /текущий пароль/);
  assert.match(html, /Подтвердить почту/);
  assert.match(html, /Завершить другие сеансы/);
  assert.match(html, /Создать семью/);
  assert.match(html, /autoComplete="current-password"/);
  assert.equal((html.match(/<form[^>]*method="post"/g) ?? []).length, 3, "unhydrated password forms must never submit via GET");
});

test("account action never exposes server internals and preserves delivery status", async () => {
  assert.deepEqual(await requestAccountAction(async () => Response.json({ delivered: false, message: "Почта недоступна", token: "must-not-escape" }), "Ошибка"), { delivered: false, message: "Почта недоступна" });
  await assert.rejects(requestAccountAction(async () => Response.json({ error: "private details" }, { status: 500 }), "Ошибка"), /Ошибка/);
  await assert.rejects(requestAccountAction(async () => Response.json({ error: "Пароли не совпадают" }, { status: 400 }), "Ошибка"), /Пароли не совпадают/);
});
