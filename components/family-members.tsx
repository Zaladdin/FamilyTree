"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FAMILY_ROLE_LABELS, FamilyMemberView, FamilyRole } from "@/lib/types";
import type { InvitationView } from "@/lib/family-invitations";
import { InvitationManager } from "@/components/invitation-manager";
import { requestAccountAction } from "@/lib/account-action-request";

type FamilyMembersProps = {
  slug: string;
  familyTitle: string;
  members: FamilyMemberView[];
  viewerRole: FamilyRole;
  backHref: string;
  invitations?: InvitationView[];
};

export function FamilyMembers({
  slug,
  familyTitle,
  members,
  viewerRole,
  backHref,
  invitations = [],
}: FamilyMembersProps) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      const result = await requestAccountAction(request, fallbackError);
      onSuccess(result);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : fallbackError);
    } finally {
      setIsSubmitting(false);
    }
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

      {errorMessage ? <p className="form-message error" role="alert">{errorMessage}</p> : null}
      {successMessage ? <p className="form-message success" role="status">{successMessage}</p> : null}

      {canManage ? (
        <InvitationManager slug={slug} viewerRole={viewerRole} invitations={invitations} onRefresh={() => router.refresh()} />
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
