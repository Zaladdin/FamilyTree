import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AccountSettings, ForgotPasswordForm, TokenActionForm } from "../../components/account-forms";
import { InvitationManager } from "../../components/invitation-manager";
import type { InvitationView } from "../../lib/family-invitations";

type View = "account" | "forgot" | "reset" | "verify" | "accept" | "invitations" | "destination";
const labels: Record<Exclude<View, "destination">, string> = { account: "Аккаунт", forgot: "Забыли пароль", reset: "Сброс пароля", verify: "Подтверждение почты", accept: "Принятие приглашения", invitations: "Управление приглашениями" };
const token = "synthetic_preview_token_only";
const state = {
  invitations: [{ id: "synthetic-invitation-1", email: "relative@example.test", role: "member", status: "pending", createdAt: "2026-09-28T10:00:00.000Z", expiresAt: "2026-10-05T10:00:00.000Z", version: 0 }] as InvitationView[],
  delivered: true, failNext: false, conflictNext: false, expireToken: false, tokenUsed: false, requests: [] as string[],
};

// Every request ends here. No fallback to the real fetch API is allowed.
window.fetch = async (input, init) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(String(init?.body ?? "{}")); } catch { return Response.json({ error: "Некорректный запрос." }, { status: 400 }); }
  const reply = (value: unknown, status = 200) => {
    state.requests.push(`${method} ${url} → ${status}`);
    return Response.json(value, { status });
  };
  if (state.failNext) { state.failNext = false; return reply({ error: "Synthetic failure must not be shown." }, 503); }
  if (url === "/api/auth/forgot-password") return reply({ message: "Если восстановление доступно, письмо будет отправлено." }, 202);
  if (url === "/api/auth/verify-email/request") return reply({ delivered: state.delivered, message: state.delivered ? "Письмо для подтверждения отправлено." : "Отправка писем пока недоступна." }, 202);
  if (["/api/auth/change-password", "/api/auth/sessions/revoke-others"].includes(url)) {
    if (payload.currentPassword === "wrong-password") return reply({ error: "Неверный текущий пароль." }, 400);
    return reply({ message: url.includes("change-password") ? "Пароль изменён. Все сеансы завершены." : "Другие сеансы завершены." });
  }
  if (["/api/auth/reset-password", "/api/auth/verify-email/confirm", "/api/invitations/accept"].includes(url)) {
    if (state.expireToken || state.tokenUsed || payload.token !== token) return reply({ error: "Ссылка недействительна или её срок истёк. Запросите новую." }, 410);
    state.tokenUsed = true;
    return reply({ message: url.includes("accept") ? "Приглашение принято." : url.includes("reset-password") ? "Пароль изменён." : "Почта подтверждена.", ...(url.includes("accept") ? { slug: "synthetic", membershipId: "synthetic-member", alreadyAccepted: false } : {}) });
  }
  if (url === "/api/family/synthetic/members" && method === "POST") {
    if (state.invitations.some((item) => item.email === payload.email && item.status === "pending")) return reply({ error: "Приглашение уже существует." }, 409);
    const invitation = { id: `synthetic-invitation-${state.invitations.length + 1}`, email: String(payload.email), role: payload.role as InvitationView["role"], status: "pending" as const, createdAt: "2026-09-28T10:00:00.000Z", expiresAt: "2026-10-05T10:00:00.000Z", version: 0 };
    state.invitations = [...state.invitations, invitation];
    return reply({ invitation, delivery: state.delivered ? "sent" : "unavailable", message: "Приглашение отправлено." });
  }
  const match = /^\/api\/family\/synthetic\/invitations\/([^/]+)(\/resend)?$/.exec(url);
  if (match) {
    const invitation = state.invitations.find((item) => item.id === match[1]);
    if (!invitation) return reply({ error: "Приглашение не найдено." }, 404);
    if (state.conflictNext) { state.conflictNext = false; invitation.version += 1; invitation.role = "guest"; }
    if (invitation.version !== payload.expectedVersion) return reply({ error: "Приглашение уже изменено." }, 409);
    invitation.version += 1;
    if (method === "DELETE") invitation.status = "revoked";
    if (method === "PATCH") invitation.role = payload.role as InvitationView["role"];
    if (match[2]) invitation.status = "pending";
    return reply({ invitation, delivery: state.delivered ? "sent" : "unavailable", message: method === "DELETE" ? "Приглашение отозвано." : "Приглашение сохранено и отправлено." });
  }
  return reply({ error: "Этот маршрут недоступен в изолированной проверке." }, 404);
};

function Preview() {
  const route: Record<string, View> = { "/account": "account", "/forgot-password": "forgot", "/reset-password": "reset", "/verify-email": "verify", "/invitations/accept": "accept" };
  const requested = new URLSearchParams(window.location.search).get("view");
  const [view, setView] = useState<View>(requested && Object.hasOwn(labels, requested) ? requested as View : route[window.location.pathname] ?? (["/", "/auth-ui"].includes(window.location.pathname) ? "account" : "destination"));
  const [generation, setGeneration] = useState(0);
  const [authenticated, setAuthenticated] = useState(true);
  const [verified, setVerified] = useState(false);
  const [legacy, setLegacy] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((value) => value + 1);
  function open(next: View) {
    state.tokenUsed = false;
    window.history.replaceState(window.history.state, "", `/auth-ui?view=${next}${["reset", "verify", "accept"].includes(next) ? `#token=${token}` : ""}`);
    setView(next); setGeneration((value) => value + 1);
  }
  return <div className="page-shell">
    <header className="account-card form-stack"><h1>Изолированная проверка аккаунта</h1><p>Только синтетические данные в памяти. Письма и запросы на сервер не отправляются.</p>
      <div className="form-actions">{Object.entries(labels).map(([value, label]) => <button type="button" className="ghost-button" key={value} onClick={() => open(value as View)}>{label}</button>)}</div>
      <div className="form-actions">
        <label><input type="checkbox" checked={authenticated} onChange={(event) => { setAuthenticated(event.target.checked); setGeneration((value) => value + 1); }} /> Вход выполнен</label>
        <label><input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} /> Почта подтверждена</label>
        <label><input type="checkbox" checked={legacy} onChange={(event) => setLegacy(event.target.checked)} /> Старый аккаунт</label>
        <label><input type="checkbox" checked={!state.delivered} onChange={(event) => { state.delivered = !event.target.checked; refresh(); }} /> Доставка недоступна</label>
        <label><input type="checkbox" checked={state.failNext} onChange={(event) => { state.failNext = event.target.checked; refresh(); }} /> Следующий ответ 503</label>
        <label><input type="checkbox" checked={state.conflictNext} onChange={(event) => { state.conflictNext = event.target.checked; refresh(); }} /> Конфликт версии при сохранении</label>
        <label><input type="checkbox" checked={state.expireToken} onChange={(event) => { state.expireToken = event.target.checked; refresh(); }} /> Срок ссылки истёк</label>
      </div>
    </header>
    <div key={`${view}-${generation}`}>
      {view === "account" ? <AccountSettings email="synthetic@example.test" firstName="Тест" lastName="Семейный" emailVerified={verified} legacyAccount={legacy} /> : null}
      {view === "invitations" ? <div className="account-layout"><InvitationManager slug="synthetic" viewerRole="owner" invitations={state.invitations.map((item) => ({ ...item }))} onRefresh={refresh} /></div> : null}
      {view === "forgot" ? <section className="account-layout account-card"><h2>Забыли пароль?</h2><ForgotPasswordForm /></section> : null}
      {["reset", "verify", "accept"].includes(view) ? <section className="account-layout account-card"><h2>{labels[view as "reset" | "verify" | "accept"]}</h2><TokenActionForm kind={view === "reset" ? "reset" : view === "verify" ? "verify" : "invitation"} authenticated={authenticated} email="synthetic@example.test" emailVerified={verified} /></section> : null}
      {view === "destination" ? <section className="account-layout account-card"><h2>Переход выполнен</h2><p>Проверочная страница назначения: {window.location.pathname}</p></section> : null}
    </div>
    <details className="account-card" key={`requests-${revision}`}><summary>Проверочные запросы без содержимого</summary><ul>{state.requests.map((item, index) => <li key={index}>{item}</li>)}</ul></details>
  </div>;
}

createRoot(document.getElementById("root")!).render(<Preview />);
