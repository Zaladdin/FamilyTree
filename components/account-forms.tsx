"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { postAccountAction, readFragmentToken, requestAccountAction } from "@/lib/account-action-request";

function useActionFeedback() {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось выполнить действие."); }
    finally { lock.current = false; setBusy(false); }
  }
  return { busy, error, message, setMessage, run, feedback: <>
    {error ? <p className="form-message error" role="alert" ref={errorRef} tabIndex={-1}>{error}</p> : null}
    {message ? <p className="form-message success" role="status">{message}</p> : null}
  </> };
}

function NewPasswordFields({ password, confirmation, onPassword, onConfirmation }: {
  password: string; confirmation: string; onPassword: (value: string) => void; onConfirmation: (value: string) => void;
}) {
  return <>
    <label className="form-field"><span>Новый пароль</span><input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={200} required value={password} onChange={(event) => onPassword(event.target.value)} /><small>От 8 до 200 символов.</small></label>
    <label className="form-field"><span>Повторите новый пароль</span><input name="passwordConfirmation" type="password" autoComplete="new-password" minLength={8} maxLength={200} required value={confirmation} onChange={(event) => onConfirmation(event.target.value)} /></label>
  </>;
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const action = useActionFeedback();
  return <form className="form-stack" method="post" onSubmit={(event) => { event.preventDefault(); void action.run(async () => {
    await requestAccountAction(() => postAccountAction("/api/auth/forgot-password", { email }), "Не удалось обработать запрос.");
    action.setMessage("Если восстановление для этого адреса доступно, на него придёт письмо. Проверьте также папку «Спам».");
  }); }}>
    <p>Укажите электронную почту своего аккаунта.</p>
    <fieldset className="story-form-fields form-stack" disabled={action.busy}>
      <label className="form-field"><span>Электронная почта</span><input name="email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <button className="primary-button" type="submit">{action.busy ? "Отправляем…" : "Отправить ссылку"}</button>
    </fieldset>
    {action.feedback}
    <p className="batch-person-hint">Для аккаунтов, созданных до введения подтверждения почты, восстановление только по письму недоступно, пока адрес не подтверждён. При сохранённом входе подтвердите почту в настройках аккаунта с текущим паролем. Иначе обратитесь к администратору сервиса.</p>
  </form>;
}

export function TokenActionForm({ kind, authenticated, email = "", emailVerified = false, token: suppliedToken }: {
  kind: "reset" | "verify" | "invitation";
  authenticated: boolean;
  email?: string;
  emailVerified?: boolean;
  token?: string;
}) {
  const [token, setToken] = useState<string | null>(suppliedToken ?? null);
  const captured = useRef(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [complete, setComplete] = useState(false);
  const [familySlug, setFamilySlug] = useState("");
  const action = useActionFeedback();
  useEffect(() => {
    if (suppliedToken !== undefined || captured.current) return;
    captured.current = true;
    setToken(readFragmentToken(window.location.hash));
    // Fragments never reach the server; remove the consumed secret from browser history as well.
    if (new URLSearchParams(window.location.hash.slice(1)).has("token")) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
  }, [suppliedToken]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action.run(async () => {
      if (!token) throw new Error("Ссылка недействительна. Откройте последнюю ссылку из письма или запросите новую.");
      if (kind === "reset" && password !== confirmation) throw new Error("Пароли не совпадают.");
      const path = kind === "reset" ? "/api/auth/reset-password" : kind === "verify" ? "/api/auth/verify-email/confirm" : "/api/invitations/accept";
      const result = await requestAccountAction(() => postAccountAction(path, { token, ...(kind === "reset" ? { password, passwordConfirmation: confirmation } : {}) }), "Не удалось использовать ссылку.");
      if (kind === "invitation" && !result.slug) throw new Error("Не удалось подтвердить вступление. Проверьте список своих семей.");
      setFamilySlug(result.slug ?? ""); setComplete(true); setToken(""); setPassword(""); setConfirmation(""); action.setMessage(result.message);
    });
  }

  if (kind !== "reset" && !authenticated) return <div className="form-stack">
    <p>Войдите в аккаунт с адресом, на который пришло письмо. После входа снова откройте ссылку из письма.</p>
    <div className="form-actions"><Link className="primary-button" href="/login?redirectTo=%2Faccount">Войти</Link><Link className="ghost-button" href="/register">Создать аккаунт</Link></div>
  </div>;
  if (kind === "invitation" && !emailVerified) return <div className="form-stack"><p>Для принятия приглашения подтвердите почту аккаунта {email}. Затем снова откройте ссылку из письма с приглашением.</p><Link className="primary-button" href="/account">Подтвердить почту</Link></div>;
  if (complete) return <div className="form-stack">{action.feedback}<Link className="primary-button" href={kind === "reset" ? "/login" : kind === "invitation" ? `/family/${encodeURIComponent(familySlug)}` : "/account"}>{kind === "reset" ? "Войти с новым паролем" : kind === "invitation" ? "Открыть семейный архив" : "Перейти в аккаунт"}</Link></div>;
  if (token === null) return <p role="status">Проверяем ссылку…</p>;
  if (!token) return <div className="form-stack"><p className="form-message error" role="alert">Ссылка отсутствует или недействительна. Откройте последнюю ссылку из письма.</p><Link href={kind === "reset" ? "/forgot-password" : "/account"}>{kind === "reset" ? "Запросить новую ссылку" : "Перейти в аккаунт"}</Link></div>;
  return <form className="form-stack" method="post" onSubmit={submit}>
    <fieldset className="story-form-fields form-stack" disabled={action.busy}>
      {kind === "reset" ? <NewPasswordFields password={password} confirmation={confirmation} onPassword={setPassword} onConfirmation={setConfirmation} /> : <p>{kind === "verify" ? "Подтвердить почту аккаунта" : "Принять приглашение в семейный архив для аккаунта"}: <strong>{email}</strong>.</p>}
      <button className="primary-button" type="submit">{action.busy ? "Сохраняем…" : kind === "reset" ? "Сохранить новый пароль" : kind === "verify" ? "Подтвердить почту" : "Принять приглашение"}</button>
    </fieldset>
    {action.feedback}
    {kind === "reset" ? <p className="batch-person-hint">После изменения пароля все прежние сеансы будут завершены. Войдите заново.</p> : null}
  </form>;
}

export function AccountSettings({ email, firstName, lastName, emailVerified, legacyAccount }: {
  email: string; firstName: string; lastName: string; emailVerified: boolean; legacyAccount: boolean;
}) {
  const action = useActionFeedback();
  const [passwords, setPasswords] = useState({ verify: "", change: "", sessions: "" });
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const id = useId();
  async function submit(kind: keyof typeof passwords, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action.run(async () => {
      if (kind === "change" && password !== confirmation) throw new Error("Пароли не совпадают.");
      const path = kind === "verify" ? "/api/auth/verify-email/request" : kind === "change" ? "/api/auth/change-password" : "/api/auth/sessions/revoke-others";
      const result = await requestAccountAction(() => postAccountAction(path, { currentPassword: passwords[kind], ...(kind === "change" ? { password, passwordConfirmation: confirmation } : {}) }), "Не удалось выполнить действие.");
      setPasswords({ verify: "", change: "", sessions: "" });
      action.setMessage(kind === "verify" && result.delivered !== true ? "Письмо не отправлено: доставка сейчас недоступна. Попробуйте позже." : result.message);
      if (kind === "change") { setPassword(""); setConfirmation(""); setSignedOut(true); }
    });
  }
  function currentPassword(kind: keyof typeof passwords) {
    return <label className="form-field" htmlFor={`${id}-${kind}`}><span>Текущий пароль</span><input id={`${id}-${kind}`} name="currentPassword" type="password" autoComplete="current-password" maxLength={200} required value={passwords[kind]} onChange={(event) => setPasswords((current) => ({ ...current, [kind]: event.target.value }))} /></label>;
  }
  return <section className="account-layout">
    <div className="archive-intro"><div><div className="eyebrow">Личный аккаунт</div><h1>{firstName} {lastName}</h1><p>{email}</p></div><div className="form-actions"><Link href="/families" className="ghost-button">Мои семьи</Link><Link href="/onboarding/family" className="primary-button">Создать семью</Link></div></div>
    {action.feedback}
    {signedOut ? <div className="account-card form-stack"><p>Пароль изменён. Все сеансы завершены.</p><Link className="primary-button" href="/login">Войти с новым паролем</Link></div> : <>
      <section className="account-card form-stack"><h2>Электронная почта</h2>
        {emailVerified ? <p className="form-message success">Почта подтверждена.</p> : <>
          <p>Подтвердите почту, чтобы принимать приглашения и восстанавливать доступ через письмо. Для отправки введите текущий пароль.</p>
          {legacyAccount ? <p className="note-box">Доступ к существующим семьям сохраняется. Ваш аккаунт создан до введения подтверждения почты: адрес не считается подтверждённым автоматически. Без текущего пароля восстановление только по письму недоступно; обратитесь к администратору сервиса.</p> : null}
          <form className="form-stack" method="post" onSubmit={(event) => { void submit("verify", event); }}><fieldset className="story-form-fields form-stack" disabled={action.busy}>{currentPassword("verify")}<button className="primary-button" type="submit">Подтвердить почту</button></fieldset></form>
        </>}
      </section>
      <section className="account-card form-stack"><h2>Изменить пароль</h2><p>Все текущие сеансы, включая этот, будут завершены.</p><form className="form-stack" method="post" onSubmit={(event) => { void submit("change", event); }}><fieldset className="story-form-fields form-stack" disabled={action.busy}>{currentPassword("change")}<NewPasswordFields password={password} confirmation={confirmation} onPassword={setPassword} onConfirmation={setConfirmation} /><button className="primary-button" type="submit">Изменить пароль</button></fieldset></form></section>
      <section className="account-card form-stack"><h2>Другие сеансы</h2><p>Завершите вход на других устройствах. Этот сеанс останется активным.</p><form className="form-stack" method="post" onSubmit={(event) => { void submit("sessions", event); }}><fieldset className="story-form-fields form-stack" disabled={action.busy}>{currentPassword("sessions")}<button className="ghost-button" type="submit">Завершить другие сеансы</button></fieldset></form></section>
    </>}
  </section>;
}
