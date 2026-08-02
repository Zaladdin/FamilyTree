"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { FAMILY_ROLE_LABELS, FamilyMemberView, FamilyRole } from "@/lib/types";

type FamilyMembersProps = {
  slug: string;
  familyTitle: string;
  members: FamilyMemberView[];
  viewerRole: FamilyRole;
  backHref: string;
};

export function FamilyMembers({
  slug,
  familyTitle,
  members,
  viewerRole,
  backHref,
}: FamilyMembersProps) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<FamilyRole>("member");

  const canManage = viewerRole === "owner" || viewerRole === "admin";
  const assignableRoles: FamilyRole[] =
    viewerRole === "owner"
      ? ["admin", "editor", "member", "guest"]
      : ["editor", "member", "guest"];

  const canManageTarget = (member: FamilyMemberView) =>
    canManage &&
    !member.isViewer &&
    member.role !== "owner" &&
    (viewerRole === "owner" || member.role !== "admin");

  async function runAction(
    request: () => Promise<Response>,
    fallbackError: string,
    onSuccess: (result: { message?: string; leftFamily?: boolean }) => void,
  ) {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      const response = await request();
      const result = (await response.json()) as {
        error?: string;
        message?: string;
        leftFamily?: boolean;
      };

      if (!response.ok) {
        throw new Error(result.error ?? fallbackError);
      }

      onSuccess(result);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : fallbackError);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleInviteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    void runAction(
      () =>
        fetch(`/api/family/${slug}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
        }),
      "Не удалось добавить участника.",
      (result) => {
        setInviteEmail("");
        setSuccessMessage(result.message ?? "Участник добавлен.");
        router.refresh();
      },
    );
  }

  function handleRoleChange(member: FamilyMemberView, role: FamilyRole) {
    void runAction(
      () =>
        fetch(`/api/family/${slug}/members/${member.membershipId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        }),
      "Не удалось изменить роль участника.",
      (result) => {
        setSuccessMessage(result.message ?? "Роль обновлена.");
        router.refresh();
      },
    );
  }

  function handleRemove(member: FamilyMemberView) {
    const confirmText = member.isViewer
      ? "Покинуть это семейное пространство?"
      : `Исключить участника "${member.name}" из семьи?`;

    if (!window.confirm(confirmText)) {
      return;
    }

    void runAction(
      () =>
        fetch(`/api/family/${slug}/members/${member.membershipId}`, {
          method: "DELETE",
        }),
      "Не удалось исключить участника.",
      (result) => {
        if (result.leftFamily) {
          router.push("/families");
          return;
        }

        setSuccessMessage(result.message ?? "Участник исключен.");
        router.refresh();
      },
    );
  }

  const viewerMembership = members.find((member) => member.isViewer);
  const canLeave = Boolean(viewerMembership) && viewerMembership?.role !== "owner";

  return (
    <section className="archive-layout">
      <div className="archive-intro">
        <div>
          <div className="eyebrow">Участники семьи</div>
          <h1>{familyTitle}</h1>
          <p>
            Здесь видно, кто имеет доступ к семейному пространству и с какой ролью.
            Владелец и администраторы могут приглашать родственников и менять роли.
          </p>
        </div>
        <div className="archive-actions">
          <Link className="ghost-button" href={backHref}>
            Вернуться в дерево
          </Link>
          {canLeave && viewerMembership ? (
            <button
              className="ghost-button"
              disabled={isSubmitting}
              onClick={() => handleRemove(viewerMembership)}
              type="button"
            >
              Покинуть семью
            </button>
          ) : null}
        </div>
      </div>

      {errorMessage ? <p className="form-message error">{errorMessage}</p> : null}
      {successMessage ? <p className="form-message success">{successMessage}</p> : null}

      {canManage ? (
        <form className="form-stack" onSubmit={handleInviteSubmit}>
          <div className="form-grid">
            <label className="form-field">
              <span>Email зарегистрированного родственника</span>
              <input
                autoComplete="off"
                name="email"
                onChange={(event) => setInviteEmail(event.target.value)}
                required
                type="email"
                value={inviteEmail}
              />
            </label>
            <label className="form-field">
              <span>Роль</span>
              <select
                name="role"
                onChange={(event) => setInviteRole(event.target.value as FamilyRole)}
                value={inviteRole}
              >
                {assignableRoles.map((role) => (
                  <option key={role} value={role}>
                    {FAMILY_ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button className="primary-button" disabled={isSubmitting} type="submit">
              Добавить участника
            </button>
          </div>
        </form>
      ) : null}

      <div className="journal-list">
        {members.map((member) => (
          <article className="journal-card" key={member.membershipId}>
            <div className="journal-meta">
              <span>
                {member.name}
                {member.isViewer ? " (это вы)" : ""}
              </span>
              <span>{member.email ?? "без аккаунта"}</span>
            </div>
            {canManageTarget(member) ? (
              <div className="form-grid">
                <label className="form-field">
                  <span>Роль</span>
                  <select
                    disabled={isSubmitting}
                    onChange={(event) =>
                      handleRoleChange(member, event.target.value as FamilyRole)
                    }
                    value={member.role}
                  >
                    {assignableRoles.map((role) => (
                      <option key={role} value={role}>
                        {FAMILY_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="form-actions">
                  <button
                    className="ghost-button"
                    disabled={isSubmitting}
                    onClick={() => handleRemove(member)}
                    type="button"
                  >
                    Исключить
                  </button>
                </div>
              </div>
            ) : (
              <strong>{FAMILY_ROLE_LABELS[member.role]}</strong>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
