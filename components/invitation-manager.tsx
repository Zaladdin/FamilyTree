"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { InvitationView } from "@/lib/family-invitations";
import { FAMILY_ROLE_LABELS, type FamilyRole } from "@/lib/types";
import { AccountActionError, requestAccountAction, type AccountActionResult } from "@/lib/account-action-request";
import { PersonFormDialog } from "@/components/person-form-dialog";

const STATUS_LABELS: Record<InvitationView["status"], string> = { pending: "Ожидает принятия", accepted: "Принято", revoked: "Отозвано", expired: "Срок истёк" };
type InvitationMode = "edit" | "revoke" | "resend";
type InvitationCallbacks = { onRefresh: () => void; onSuccess: (message: string) => void; onClose: () => void };

function assignableRoles(role: FamilyRole): FamilyRole[] {
  return role === "owner" ? ["admin", "editor", "member", "guest"] : ["editor", "member", "guest"];
}

function deliveryMessage(result: AccountActionResult, deliveryExpected: boolean) {
  if (deliveryExpected && result.delivery !== "sent") return "Приглашение сохранено, но письмо не отправлено: доставка сейчас недоступна. Попробуйте «Отправить снова» позже.";
  return result.message;
}

export function InvitationChangeDialog({ slug, invitation, viewerRole, mode, onClose, onRefresh, onSuccess }: InvitationCallbacks & {
  slug: string; invitation: InvitationView; viewerRole: FamilyRole; mode: InvitationMode;
}) {
  // An open draft always submits the version that was actually shown to its author.
  const [original] = useState(() => ({ ...invitation }));
  const [role, setRole] = useState(original.role);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const title = mode === "edit" ? "Изменить роль приглашения" : mode === "revoke" ? "Отозвать приглашение" : "Отправить приглашение снова";
  function close() {
    if (submitting.current) return;
    if (role !== original.role && !window.confirm("Есть несохранённые изменения. Выйти без сохранения?")) return;
    onClose();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      const path = `/api/family/${encodeURIComponent(slug)}/invitations/${encodeURIComponent(original.id)}${mode === "resend" ? "/resend" : ""}`;
      const result = await requestAccountAction(() => fetch(path, {
        method: mode === "edit" ? "PATCH" : mode === "revoke" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: original.version, ...(mode === "edit" ? { role } : {}) }),
      }), "Не удалось изменить приглашение.");
      onSuccess(deliveryMessage(result, mode !== "revoke")); onRefresh(); onClose();
    } catch (failure) {
      if (failure instanceof AccountActionError && failure.status === 409) {
        onRefresh();
        setError("Приглашение уже изменено. Черновик сохранён. Закройте форму и откройте приглашение заново, затем повторите нужные изменения.");
      } else setError(failure instanceof Error ? failure.message : "Не удалось изменить приглашение.");
    } finally { submitting.current = false; setBusy(false); }
  }
  return <PersonFormDialog title={title} description={original.email} closeLabel="Закрыть изменение приглашения" busy={busy} onClose={close}>
    <form className="form-stack person-mini-form" method="post" onSubmit={submit}>
      <p className="note-box">Получатель: <strong>{original.email}</strong>. Роль: {FAMILY_ROLE_LABELS[original.role]}.</p>
      <fieldset disabled={busy} className="story-form-fields form-stack">
        {mode === "edit" ? <label className="form-field"><span>Роль</span><select name="role" value={role} onChange={(event) => setRole(event.target.value as FamilyRole)}>{assignableRoles(viewerRole).map((value) => <option key={value} value={value}>{FAMILY_ROLE_LABELS[value]}</option>)}</select></label> : <p>{mode === "revoke" ? "Получатель больше не сможет принять это приглашение. Уже выданный доступ участников не изменится." : "Будет создана новая ссылка. Прежняя ссылка перестанет работать. Если отправка недоступна, повторите её позже."}</p>}
        <div className="form-actions"><button className="primary-button" type="submit">{busy ? "Сохраняем…" : mode === "edit" ? "Сохранить роль" : mode === "revoke" ? "Отозвать приглашение" : "Отправить снова"}</button><button className="ghost-button" type="button" data-autofocus onClick={close}>Отмена</button></div>
      </fieldset>
      {error ? <p className="form-message error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p> : null}
    </form>
  </PersonFormDialog>;
}

export function InvitationManager({ slug, viewerRole, invitations, onRefresh }: {
  slug: string; viewerRole: FamilyRole; invitations: InvitationView[]; onRefresh: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<FamilyRole>("member");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const restoreFocus = useRef(false);
  const [editing, setEditing] = useState<{ invitation: InvitationView; mode: InvitationMode } | null>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (!editing && restoreFocus.current) { headingRef.current?.focus(); restoreFocus.current = false; } }, [editing]);
  if (viewerRole !== "owner" && viewerRole !== "admin") return null;

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await requestAccountAction(() => fetch(`/api/family/${encodeURIComponent(slug)}/members`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role }),
      }), "Не удалось создать приглашение.");
      setEmail(""); setMessage(deliveryMessage(result, true)); onRefresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось создать приглашение."); }
    finally { submitting.current = false; setBusy(false); }
  }

  return <section className="account-card form-stack" aria-labelledby={headingId}>
    <h2 id={headingId} ref={headingRef} tabIndex={-1}>Приглашения</h2>
    <p>Пригласите родственника по электронной почте, даже если у него ещё нет аккаунта. Принятие приглашения с подтверждённой почтой откроет доступ к семье.</p>
    <form className="form-stack" method="post" onSubmit={create}><fieldset className="story-form-fields form-stack" disabled={busy || Boolean(editing)}>
      <div className="form-grid"><label className="form-field"><span>Электронная почта родственника</span><input autoComplete="off" name="email" type="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="form-field"><span>Роль приглашённого</span><select name="role" value={role} onChange={(event) => setRole(event.target.value as FamilyRole)}>{assignableRoles(viewerRole).map((value) => <option key={value} value={value}>{FAMILY_ROLE_LABELS[value]}</option>)}</select></label></div>
      <div className="form-actions"><button className="primary-button" type="submit">{busy ? "Сохраняем…" : "Пригласить родственника"}</button></div>
    </fieldset></form>
    {error ? <p className="form-message error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p> : null}
    {message ? <p className="form-message success" role="status">{message}</p> : null}
    {!invitations.length ? <p>Приглашений пока нет.</p> : <ul className="invitation-list">
      {invitations.map((invitation) => {
        const manageable = invitation.role !== "owner" && (viewerRole === "owner" || invitation.role !== "admin");
        return <li key={invitation.id} className="note-box form-stack"><div><strong>{invitation.email}</strong><p>{FAMILY_ROLE_LABELS[invitation.role]} · {STATUS_LABELS[invitation.status]}</p><p className="batch-person-hint">Срок действия: <time dateTime={invitation.expiresAt}>{new Date(invitation.expiresAt).toLocaleDateString("ru-RU", { timeZone: "UTC" })}</time></p></div>
          {manageable && invitation.status !== "accepted" ? <div className="form-actions">
            {invitation.status === "pending" ? <button className="secondary-button" type="button" disabled={busy || Boolean(editing)} aria-label={`Изменить роль: ${invitation.email}`} onClick={() => { setMessage(""); setEditing({ invitation, mode: "edit" }); }}>Изменить роль</button> : null}
            {invitation.status === "pending" || invitation.status === "expired" ? <button className="ghost-button" type="button" disabled={busy || Boolean(editing)} aria-label={`Отозвать приглашение: ${invitation.email}`} onClick={() => { setMessage(""); setEditing({ invitation, mode: "revoke" }); }}>Отозвать</button> : null}
            <button className="ghost-button" type="button" disabled={busy || Boolean(editing)} aria-label={`Отправить снова: ${invitation.email}`} onClick={() => { setMessage(""); setEditing({ invitation, mode: "resend" }); }}>Отправить снова</button>
          </div> : null}
        </li>;
      })}
    </ul>}
    {editing ? <InvitationChangeDialog slug={slug} invitation={editing.invitation} viewerRole={viewerRole} mode={editing.mode} onRefresh={onRefresh} onSuccess={(value) => { setMessage(value); restoreFocus.current = true; }} onClose={() => setEditing(null)} /> : null}
  </section>;
}
