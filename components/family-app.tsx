"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AddPersonInput,
  AddRelationshipKind,
  PersonUpdateRequest,
  PersonRelationshipInput,
} from "@/lib/family-logic";
import { Family, FamilyPerson, Gender, MediaAsset, Story } from "@/lib/types";
import { FamilyWorkspace } from "@/components/family-workspace";
import { PersonFormDialog } from "@/components/person-form-dialog";
import { PersonLifeFields } from "@/components/person-life-fields";
import { BatchPersonDialog } from "@/components/batch-person-dialog";
import type { BatchPersonEntry } from "@/lib/family-batch";
import { requestFamilyAction } from "@/lib/family-action-request";
import { AdditionalRelationshipsFields, AutomaticParenthoodNotice, ExistingRelationshipFields, type ExistingRelationshipKind } from "@/components/family-relationship-fields";
import { RecordedRelationships } from "@/components/recorded-relationships";
import { normalizeTreeScale } from "@/lib/tree-viewport";
import { StoryChangeDialog, type StoryDialogMode } from "@/components/story-dialog";
import { useUnsavedChanges } from "@/components/use-unsaved-changes";

type FamilyAppProps = {
  canEdit: boolean;
  initialFamily: Family;
  initialFocusPersonId: string | null;
};

type AddFormState = {
  firstName: string;
  lastName: string;
  middleName: string;
  status: FamilyPerson["status"];
  deathDate: string;
  gender: Gender;
  birthDate: string;
  birthPlace: string;
  biography: string;
  relationshipKind: AddRelationshipKind;
  relativePersonId: string;
  sharedChildIds: string[];
  additionalRelationships: PersonRelationshipInput[];
};

type EditFormState = {
  expectedVersion: number | undefined;
  firstName: string;
  lastName: string;
  middleName: string;
  gender: Gender;
  birthDate: string;
  birthPlace: string;
  biography: string;
  note: string;
  status: FamilyPerson["status"];
  deathDate: string;
};

type ApiResponse = {
  error?: string;
  message?: string;
  personId?: string;
  warnings?: string[];
};

function successWithWarnings(result: ApiResponse, fallback: string) {
  return [result.message ?? fallback, ...(result.warnings ?? [])].join(" ");
}

type UploadMediaState = {
  type: "photo" | "audio";
  file: File | null;
};

const initialAddFormState = (
  focusPersonId: string | null,
  relationshipKind: AddRelationshipKind = "child",
): AddFormState => ({
  firstName: "",
  lastName: "",
  middleName: "",
  status: "living",
  deathDate: "",
  gender: "female",
  birthDate: "",
  birthPlace: "",
  biography: "",
  relationshipKind,
  relativePersonId: focusPersonId ?? "",
  sharedChildIds: [],
  additionalRelationships: [],
});

// API мутаций над людьми подтверждает успех наличием personId в ответе,
// поэтому его отсутствие трактуем как ошибку даже при статусе 200.
function requirePersonId(result: ApiResponse, fallbackError: string): string {
  if (!result.personId) {
    throw new Error(result.error ?? fallbackError);
  }

  return result.personId;
}

const initialEditFormState = (person: FamilyPerson): EditFormState => ({
  // Keep the revision of the opened draft even if fresh server props arrive.
  expectedVersion: person.version,
  firstName: person.firstName,
  lastName: person.lastName,
  middleName: person.middleName ?? "",
  gender: person.gender,
  birthDate: person.birthDate,
  birthPlace: person.birthPlace,
  biography: person.biography,
  note: person.note ?? "",
  status: person.status,
  deathDate: person.deathDate ?? "",
});

type SheetShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
};

function SheetShell({
  eyebrow,
  title,
  description,
  onClose,
  children,
}: SheetShellProps) {
  return (
    <section className="workspace-form-card">
      <div className="canvas-header">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h2>{title}</h2>
          <p className="sheet-subtitle">{description}</p>
        </div>
        <button className="ghost-button" onClick={onClose} type="button">
          Закрыть
        </button>
      </div>
      {children}
    </section>
  );
}

export function FamilyApp({
  canEdit,
  initialFamily,
  initialFocusPersonId,
}: FamilyAppProps) {
  const [canvasScale, setCanvasScale] = useState(1);
  const [activeSheet, setActiveSheet] = useState<"add" | "batch" | "relationship" | "edit" | "media" | "story" | null>(null);
  const [sheetPersonId, setSheetPersonId] = useState<string | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState(initialFocusPersonId);
  const [sheetPerson, setSheetPerson] = useState<FamilyPerson | null>(null);
  const draftBaseline = useRef("");
  const [childDirty, setChildDirty] = useState(false);
  const [childBusy, setChildBusy] = useState(false);
  const [batchSeedDirty, setBatchSeedDirty] = useState(false);
  const storySequence = useRef(0);
  const [storyFocusRevision, setStoryFocusRevision] = useState(0);
  const [storyEditor, setStoryEditor] = useState<{ mode: StoryDialogMode; story?: Story; person: FamilyPerson; instance: number } | null>(null);
  const [addFormState, setAddFormState] = useState(() =>
    initialAddFormState(initialFocusPersonId),
  );
  const [editFormState, setEditFormState] = useState<EditFormState | null>(null);
  const [relationshipFormState, setRelationshipFormState] = useState<{ relativePersonId: string; relationshipKind: ExistingRelationshipKind }>({ relativePersonId: "", relationshipKind: "parent" });
  const [uploadMediaState, setUploadMediaState] = useState<UploadMediaState>({
    type: "photo",
    file: null,
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const family = initialFamily;
  const focusPerson =
    family.people.find((person) => person.id === selectedPersonId) ?? null;
  const focusPersonId = focusPerson?.id ?? null;
  const draftPerson = sheetPersonId ? family.people.find((person) => person.id === sheetPersonId) ?? sheetPerson : null;
  const isDirty = activeSheet === "batch" || activeSheet === "story" ? childDirty
    : activeSheet === "add" ? JSON.stringify(addFormState) !== draftBaseline.current
      : activeSheet === "edit" ? JSON.stringify(editFormState) !== draftBaseline.current
        : activeSheet === "relationship" ? childDirty || JSON.stringify(relationshipFormState) !== draftBaseline.current
          : activeSheet === "media" ? uploadMediaState.file !== null || uploadMediaState.type !== "photo" : false;
  const { confirmDiscard, bypass } = useUnsavedChanges(isDirty, isSubmitting || childBusy);

  const discardSheet = useCallback(() => {
    setActiveSheet(null);
    setSheetPersonId(null);
    setSheetPerson(null);
    setEditFormState(null);
    setRelationshipFormState({ relativePersonId: "", relationshipKind: "parent" });
    setUploadMediaState({ type: "photo", file: null });
    setStoryEditor(null);
    setChildDirty(false);
    setChildBusy(false);
    setErrorMessage("");
  }, []);

  // A refreshed URL never silently discards an open draft. On a rejected
  // same-page Back/Forward, retain its person and restore that perspective's URL.
  const observedFocus = useRef(initialFocusPersonId);
  useEffect(() => {
    if (observedFocus.current === initialFocusPersonId) return;
    observedFocus.current = initialFocusPersonId;
    if (selectedPersonId === initialFocusPersonId) return;
    if (!confirmDiscard()) {
      const params = new URLSearchParams(searchParams.toString());
      if (selectedPersonId) params.set("person", selectedPersonId); else params.delete("person");
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      return;
    }
    discardSheet();
    setSelectedPersonId(initialFocusPersonId);
    setAddFormState(initialAddFormState(initialFocusPersonId));
  }, [initialFocusPersonId, selectedPersonId, confirmDiscard, searchParams, router, pathname, discardSheet]);

  function syncFocus(nextFocusPersonId: string | null) {
    if (nextFocusPersonId !== null && !family.people.some((person) => person.id === nextFocusPersonId)) {
      return;
    }
    if (nextFocusPersonId === focusPersonId || !confirmDiscard()) return;
    discardSheet();
    setSelectedPersonId(nextFocusPersonId);
    setSuccessMessage("");
    setAddFormState(initialAddFormState(nextFocusPersonId));
    const params = new URLSearchParams(searchParams.toString());
    if (nextFocusPersonId === null) {
      params.delete("person");
    } else {
      params.set("person", nextFocusPersonId);
    }
    const query = params.toString();

    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  function closeSheet() {
    if (confirmDiscard()) discardSheet();
  }

  function handleOpenAddPerson() {
    if (!canEdit || !confirmDiscard()) return;
    discardSheet();
    const draft = initialAddFormState(focusPersonId);
    draftBaseline.current = JSON.stringify(draft);
    setActiveSheet("add");
    setSheetPersonId(null);
    setErrorMessage("");
    setSuccessMessage("");
    setAddFormState(draft);
  }

  function handleOpenAddRelationship() {
    if (!canEdit || !focusPerson || !confirmDiscard()) return;
    discardSheet();
    draftBaseline.current = JSON.stringify({ relativePersonId: "", relationshipKind: "parent" });
    setActiveSheet("relationship");
    setSheetPersonId(focusPerson.id);
    setSheetPerson(focusPerson);
    setRelationshipFormState({ relativePersonId: "", relationshipKind: "parent" });
    setErrorMessage("");
    setSuccessMessage("");
  }

  function handleZoomIn() {
    setCanvasScale((current) => normalizeTreeScale(current + 0.1));
  }

  function handleZoomOut() {
    setCanvasScale((current) => normalizeTreeScale(current - 0.1));
  }

  function handleResetZoom() {
    setCanvasScale(1);
  }

  function handleScaleChange(nextScale: number) {
    setCanvasScale(normalizeTreeScale(nextScale));
  }

  function handleOpenEditPerson() {
    if (!canEdit || !focusPerson || !confirmDiscard()) return;
    discardSheet();
    const draft = initialEditFormState(focusPerson);
    draftBaseline.current = JSON.stringify(draft);
    setActiveSheet("edit");
    setSheetPersonId(focusPerson.id);
    setSheetPerson(focusPerson);
    setErrorMessage("");
    setSuccessMessage("");
    setEditFormState(draft);
  }

  function handleOpenUploadMedia() {
    if (!canEdit || !focusPerson || !confirmDiscard()) return;
    discardSheet();
    setActiveSheet("media");
    setSheetPersonId(focusPerson.id);
    setSheetPerson(focusPerson);
    setErrorMessage("");
    setSuccessMessage("");
    setUploadMediaState({
      type: "photo",
      file: null,
    });
  }

  function handleOpenCreateStory() {
    openStory("create");
  }

  function openStory(mode: StoryDialogMode, story?: Story) {
    if (!canEdit || !focusPerson || !confirmDiscard()) return;
    discardSheet();
    setActiveSheet("story");
    setSheetPersonId(focusPerson.id);
    setSheetPerson(focusPerson);
    setStoryEditor({ mode, story, person: focusPerson, instance: ++storySequence.current });
    setErrorMessage("");
    setSuccessMessage("");
  }

  // Общий каркас всех мутаций: сброс сообщений, блокировка формы, разбор
  // ответа API и единая обработка ошибок. onSuccess выполняется внутри try,
  // поэтому может выбросить ошибку и попасть в общий catch.
  async function runAction({
    request,
    fallbackError,
    onSuccess,
  }: {
    request: () => Promise<Response>;
    fallbackError: string;
    onSuccess: (result: ApiResponse) => void;
  }) {
    setErrorMessage("");
    setSuccessMessage("");
    setIsSubmitting(true);

    try {
      const result = await requestFamilyAction(request, fallbackError);

      onSuccess(result);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : fallbackError);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAddSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || isSubmitting) return;
    if (family.people.length > 0 && !family.people.some((person) => person.id === addFormState.relativePersonId)) {
      setErrorMessage("Выберите родственника, с которым нужно связать нового человека.");
      return;
    }

    const payload: AddPersonInput = {
      firstName: addFormState.firstName,
      lastName: addFormState.lastName,
      middleName: addFormState.middleName,
      status: addFormState.status,
      deathDate: addFormState.status === "deceased" ? addFormState.deathDate : "",
      gender: addFormState.gender,
      birthDate: addFormState.birthDate,
      birthPlace: addFormState.birthPlace,
      biography: addFormState.biography,
      relationshipKind: addFormState.relationshipKind,
      relativePersonId: addFormState.relativePersonId,
      additionalRelationships: family.people.length ? addFormState.additionalRelationships : [],
    };

    await runAction({
      request: () =>
        fetch(`/api/family/${family.slug}/people`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }),
      fallbackError: "Не удалось добавить человека.",
      onSuccess: (result) => {
        const personId = requirePersonId(result, "Не удалось добавить человека.");

        setAddFormState(initialAddFormState(personId));
        bypass();
        discardSheet();
        setSelectedPersonId(personId);
        setSuccessMessage(successWithWarnings(result, "Человек добавлен."));

        const params = new URLSearchParams(searchParams.toString());
        params.set("person", personId);

        startTransition(() => {
          router.replace(`${pathname}?${params.toString()}`, { scroll: false });
          router.refresh();
        });
      },
    });
  }

  async function handleBatchSubmit(people: BatchPersonEntry[]) {
    if (!canEdit || isSubmitting || isPending) return;
    await runAction({
      request: () => fetch(`/api/family/${family.slug}/people/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ people }),
      }),
      fallbackError: "Не удалось добавить людей. Введённые данные сохранены в форме.",
      onSuccess: (result) => {
        const personId = requirePersonId(result, "Не удалось подтвердить добавление людей. Обновите дерево перед повторной попыткой.");
        bypass();
        discardSheet();
        setSelectedPersonId(personId);
        setSuccessMessage(successWithWarnings(result, `Добавлено людей: ${people.length}.`));
        const params = new URLSearchParams(searchParams.toString());
        params.set("person", personId);
        startTransition(() => {
          router.replace(`${pathname}?${params.toString()}`, { scroll: false });
          router.refresh();
        });
      },
    });
  }

  async function handleEditSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canEdit || !draftPerson || !editFormState || isSubmitting) {
      return;
    }

    const expectedVersion = editFormState.expectedVersion;
    if (expectedVersion === undefined || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      setErrorMessage("Не удалось определить версию карточки. Скопируйте черновик и обновите страницу перед сохранением.");
      return;
    }

    const payload: PersonUpdateRequest = {
      expectedVersion,
      firstName: editFormState.firstName,
      lastName: editFormState.lastName,
      middleName: editFormState.middleName,
      gender: editFormState.gender,
      birthDate: editFormState.birthDate,
      birthPlace: editFormState.birthPlace,
      biography: editFormState.biography,
      note: editFormState.note,
      status: editFormState.status,
      deathDate: editFormState.deathDate,
    };

    await runAction({
      request: async () => {
        const response = await fetch(`/api/family/${family.slug}/people/${draftPerson.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        if (response.status === 409) {
          // Refresh the saved card while retaining this draft and its original
          // revision. Reopening the editor then starts from the latest card.
          startTransition(() => router.refresh());
        }
        return response;
      },
      fallbackError: "Не удалось обновить карточку человека.",
      onSuccess: (result) => {
        requirePersonId(result, "Не удалось обновить карточку человека.");

        bypass();
        discardSheet();
        setSuccessMessage(result.message ?? "Карточка обновлена.");

        startTransition(() => {
          router.refresh();
        });
      },
    });
  }

  async function handleRelationshipSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || !draftPerson || isSubmitting || isPending) return;
    if (!family.people.some((person) => person.id === relationshipFormState.relativePersonId && person.id !== draftPerson.id && !person.isArchived)) {
      setErrorMessage("Выберите другого человека из этого дерева.");
      return;
    }
    await runAction({
      request: () => fetch(`/api/family/${family.slug}/people/${draftPerson.id}/relationships`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(relationshipFormState),
      }),
      fallbackError: "Не удалось добавить связь.",
      onSuccess: (result) => {
        requirePersonId(result, "Не удалось добавить связь.");
        bypass();
        discardSheet();
        setSuccessMessage(successWithWarnings(result, "Связь добавлена."));
        startTransition(() => router.refresh());
      },
    });
  }

  async function handleUploadMediaSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || !draftPerson || isSubmitting) return;
    setErrorMessage("");
    setSuccessMessage("");

    const file = uploadMediaState.file;

    if (!file) {
      setErrorMessage("Сначала выбери файл для загрузки.");
      return;
    }

    await runAction({
      request: () => {
        const formData = new FormData();
        formData.append("type", uploadMediaState.type);
        formData.append("file", file);

        return fetch(`/api/family/${family.slug}/people/${draftPerson.id}/media`, {
          method: "POST",
          body: formData,
        });
      },
      fallbackError: "Не удалось загрузить файл.",
      onSuccess: (result) => {
        bypass();
        discardSheet();
        setUploadMediaState({
          type: "photo",
          file: null,
        });
        setSuccessMessage(result.message ?? "Файл добавлен.");

        startTransition(() => {
          router.refresh();
        });
      },
    });
  }

  async function handleDeleteMedia(asset: MediaAsset) {
    if (!canEdit || !focusPerson || isSubmitting || !focusPerson.mediaAssets.some((item) => item.id === asset.id)) return;
    await runAction({
      request: () =>
        fetch(
          `/api/family/${family.slug}/people/${focusPerson.id}/media/${asset.id}`,
          {
            method: "DELETE",
          },
        ),
      fallbackError: "Не удалось удалить медиафайл.",
      onSuccess: (result) => {
        setSuccessMessage(result.message ?? "Медиафайл удален.");

        startTransition(() => {
          router.refresh();
        });
      },
    });
  }

  async function handleArchivePerson() {
    if (!canEdit || !focusPerson || isSubmitting || !confirmDiscard()) return;
    await runAction({
      request: () =>
        fetch(`/api/family/${family.slug}/people/${focusPerson.id}/archive`, {
          method: "POST",
        }),
      fallbackError: "Не удалось архивировать человека.",
      onSuccess: (result) => {
        requirePersonId(result, "Не удалось архивировать человека.");

        bypass();
        discardSheet();
        setSelectedPersonId(null);
        setSuccessMessage(result.message ?? "Человек архивирован.");

        const params = new URLSearchParams(searchParams.toString());
        params.delete("person");
        const query = params.toString();

        startTransition(() => {
          router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
          router.refresh();
        });
      },
    });
  }

  return (
    <FamilyWorkspace
      family={family}
      focusPersonId={focusPersonId}
      canEdit={canEdit}
      canvasScale={canvasScale}
      onFocusPerson={syncFocus}
      onZoomIn={handleZoomIn}
      onZoomOut={handleZoomOut}
      onResetZoom={handleResetZoom}
      onScaleChange={handleScaleChange}
      onOpenAddPerson={canEdit ? handleOpenAddPerson : undefined}
      onOpenAddRelationship={canEdit && focusPerson ? handleOpenAddRelationship : undefined}
      onOpenEditPerson={canEdit && focusPerson ? handleOpenEditPerson : undefined}
      onOpenUploadMedia={canEdit && focusPerson ? handleOpenUploadMedia : undefined}
      onOpenCreateStory={canEdit && focusPerson ? handleOpenCreateStory : undefined}
      onEditStory={canEdit && focusPerson ? (story) => openStory("edit", story) : undefined}
      onDeleteStory={canEdit && focusPerson ? (story) => openStory("delete", story) : undefined}
      onRestoreStory={canEdit && focusPerson ? (story) => openStory("restore", story) : undefined}
      storyFocusRevision={storyFocusRevision}
      onDeleteMedia={canEdit && focusPerson ? handleDeleteMedia : undefined}
      onArchivePerson={canEdit && focusPerson ? handleArchivePerson : undefined}
      addPersonSheet={
        activeSheet === "add" ? (
          <PersonFormDialog
            description={family.people.length ? "Укажите основные данные и связь с семьёй." : "С него начнётся история вашей семьи."}
            busy={isSubmitting || isPending}
            onClose={closeSheet}
            title={family.people.length ? "Добавить человека" : "Добавить первого человека"}
          >
            <form className="form-stack person-mini-form" onSubmit={handleAddSubmit}>
              <fieldset className="story-form-fields form-stack" disabled={isSubmitting || isPending}>
              <button className="secondary-button" disabled={isSubmitting || isPending} type="button" onClick={() => { setErrorMessage(""); setBatchSeedDirty(isDirty); setChildDirty(isDirty); setActiveSheet("batch"); }}>Несколько человек</button>
              <div className="form-grid">
                <label className="form-field">
                  <span>Имя</span>
                  <input
                    data-autofocus
                    autoComplete="given-name"
                    onChange={(event) =>
                      setAddFormState((current) => ({
                        ...current,
                        firstName: event.target.value,
                      }))
                    }
                    required
                    value={addFormState.firstName}
                  />
                </label>
                <label className="form-field">
                  <span>Фамилия</span>
                  <input
                    onChange={(event) =>
                      setAddFormState((current) => ({
                        ...current,
                        lastName: event.target.value,
                      }))
                    }
                    required
                    value={addFormState.lastName}
                  />
                </label>
              </div>

              <label className="form-field">
                <span>Отчество</span>
                <input autoComplete="additional-name" onChange={(event) => setAddFormState((current) => ({ ...current, middleName: event.target.value }))} value={addFormState.middleName} />
              </label>

              <div className="form-grid">
                <label className="form-field">
                  <span>Пол</span>
                  <select
                    className="form-select"
                    onChange={(event) =>
                      setAddFormState((current) => ({
                        ...current,
                        gender: event.target.value as Gender,
                      }))
                    }
                    value={addFormState.gender}
                  >
                    <option value="male">Мужской</option>
                    <option value="female">Женский</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Дата рождения</span>
                  <input
                    onChange={(event) =>
                      setAddFormState((current) => ({
                        ...current,
                        birthDate: event.target.value,
                      }))
                    }
                    placeholder="Год или ДД.ММ.ГГГГ"
                    required
                    value={addFormState.birthDate}
                  />
                </label>
              </div>
                <label className="form-field">
                  <span>Место рождения</span>
                  <input
                    onChange={(event) =>
                      setAddFormState((current) => ({
                        ...current,
                        birthPlace: event.target.value,
                      }))
                    }
                    required
                    value={addFormState.birthPlace}
                  />
                </label>

              <PersonLifeFields status={addFormState.status} deathDate={addFormState.deathDate} onChange={(life) => setAddFormState((current) => ({ ...current, ...life }))} />

              {family.people.length > 0 ? (
              <div className="form-grid">
                <label className="form-field">
                  <span>Кем приходится</span>
                  <select
                    className="form-select"
                    onChange={(event) =>
                      setAddFormState((current) => ({
                        ...current,
                        relationshipKind: event.target.value as AddRelationshipKind,
                        sharedChildIds: [],
                      }))
                    }
                    value={addFormState.relationshipKind}
                  >
                    <option value="child">Ребенок</option>
                    <option value="parent">Родитель</option>
                    <option value="spouse">Супруг / супруга</option>
                    <option value="sibling">Брат / сестра</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>С кем связать</span>
                  <select
                    className="form-select"
                    onChange={(event) =>
                      setAddFormState((current) => ({
                        ...current,
                        relativePersonId: event.target.value,
                        sharedChildIds: [],
                      }))
                    }
                    required
                    value={addFormState.relativePersonId}
                  >
                    <option disabled value="">Выберите родственника</option>
                    {family.people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {[person.firstName, person.middleName, person.lastName]
                          .filter(Boolean)
                          .join(" ")}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              ) : null}

              {family.people.length > 0 ? <AutomaticParenthoodNotice relationshipKind={addFormState.relationshipKind} /> : null}
              {family.people.length > 0 ? <AdditionalRelationshipsFields people={family.people} relationships={addFormState.additionalRelationships} disabled={isSubmitting || isPending} onChange={(additionalRelationships) => setAddFormState((current) => ({ ...current, additionalRelationships }))} /> : null}

              <details className="person-mini-form__details">
                <summary>Дополнительно <span>биография</span></summary>
                <div>
                  <label className="form-field">
                    <span>Краткая биография</span>
                    <textarea
                      onChange={(event) => setAddFormState((current) => ({ ...current, biography: event.target.value }))}
                      rows={3}
                      value={addFormState.biography}
                    />
                  </label>
                </div>
              </details>

              {errorMessage ? <p className="form-message error" role="alert">{errorMessage}</p> : null}

              <div className="form-actions">
                <button className="primary-button" disabled={isSubmitting || isPending} type="submit">
                  {isSubmitting ? "Сохраняем..." : "Добавить"}
                </button>
                <button className="ghost-button" disabled={isSubmitting || isPending} onClick={closeSheet} type="button">
                  Отмена
                </button>
              </div>
              </fieldset>
            </form>
          </PersonFormDialog>
        ) : activeSheet === "batch" ? (
          <BatchPersonDialog family={family} focusPersonId={focusPersonId} initialPerson={addFormState} initialDirty={batchSeedDirty} onDirtyChange={setChildDirty} busy={isSubmitting || isPending} errorMessage={errorMessage} onClose={closeSheet} onSubmit={handleBatchSubmit} />
        ) : activeSheet === "relationship" && draftPerson ? (
          <SheetShell
            description="Проверьте записанные связи, исправьте их или добавьте связь с существующим человеком. Дерево обновится после сохранения."
            eyebrow="Родственные связи"
            onClose={closeSheet}
            title="Связи человека"
          >
            <RecordedRelationships family={family} subject={draftPerson}
              disabled={isSubmitting || isPending}
              onSuccess={(result) => setSuccessMessage(successWithWarnings(result, "Связь сохранена."))}
              onDirtyChange={setChildDirty} onBusyChange={setChildBusy} confirmDiscard={confirmDiscard}
              onRefresh={() => startTransition(() => router.refresh())} />
            <h3>Добавить связь</h3>
            <form className="form-stack" onSubmit={handleRelationshipSubmit}>
              <ExistingRelationshipFields
                subject={draftPerson}
                people={family.people}
                relativePersonId={relationshipFormState.relativePersonId}
                relationshipKind={relationshipFormState.relationshipKind}
                disabled={isSubmitting || isPending}
                onRelativeChange={(relativePersonId) => setRelationshipFormState((current) => ({ ...current, relativePersonId }))}
                onKindChange={(relationshipKind) => setRelationshipFormState((current) => ({ ...current, relationshipKind }))}
              />
              {errorMessage ? <p className="form-message error" role="alert">{errorMessage}</p> : null}
              <div className="form-actions">
                <button className="primary-button" disabled={isSubmitting || isPending || !relationshipFormState.relativePersonId} type="submit">
                  {isSubmitting ? "Сохраняем..." : "Сохранить связь"}
                </button>
                <button className="ghost-button" onClick={closeSheet} type="button">Отмена</button>
              </div>
            </form>
          </SheetShell>
        ) : activeSheet === "edit" && draftPerson && editFormState ? (
          <SheetShell
            description="Изменения сохраняются в базу и сразу отражаются в карточке человека и дереве."
            eyebrow="Редактирование"
            onClose={closeSheet}
            title="Редактировать карточку человека"
          >
            <form className="form-stack" onSubmit={handleEditSubmit}>
              <fieldset className="story-form-fields form-stack" disabled={isSubmitting || isPending}>
              <div className="form-grid">
                <label className="form-field">
                  <span>Имя</span>
                  <input
                    onChange={(event) =>
                      setEditFormState((current) =>
                        current
                          ? { ...current, firstName: event.target.value }
                          : current,
                      )
                    }
                    required
                    value={editFormState.firstName}
                  />
                </label>
                <label className="form-field">
                  <span>Фамилия</span>
                  <input
                    onChange={(event) =>
                      setEditFormState((current) =>
                        current
                          ? { ...current, lastName: event.target.value }
                          : current,
                      )
                    }
                    required
                    value={editFormState.lastName}
                  />
                </label>
              </div>

              <div className="form-grid">
                <label className="form-field">
                  <span>Отчество</span>
                  <input
                    onChange={(event) =>
                      setEditFormState((current) =>
                        current
                          ? { ...current, middleName: event.target.value }
                          : current,
                      )
                    }
                    value={editFormState.middleName}
                  />
                </label>
                <label className="form-field">
                  <span>Пол</span>
                  <select
                    className="form-select"
                    onChange={(event) =>
                      setEditFormState((current) =>
                        current
                          ? { ...current, gender: event.target.value as Gender }
                          : current,
                      )
                    }
                    value={editFormState.gender}
                  >
                    <option value="male">Мужской</option>
                    <option value="female">Женский</option>
                  </select>
                </label>
              </div>

              <div className="form-grid">
                <label className="form-field">
                  <span>Дата рождения</span>
                  <input
                    onChange={(event) =>
                      setEditFormState((current) =>
                        current
                          ? { ...current, birthDate: event.target.value }
                          : current,
                      )
                    }
                    required
                    value={editFormState.birthDate}
                  />
                </label>
                <label className="form-field">
                  <span>Место рождения</span>
                  <input
                    onChange={(event) =>
                      setEditFormState((current) =>
                        current
                          ? { ...current, birthPlace: event.target.value }
                          : current,
                      )
                    }
                    required
                    value={editFormState.birthPlace}
                  />
                </label>
              </div>

              <div className="form-grid">
                <label className="form-field">
                  <span>Статус</span>
                  <select
                    className="form-select"
                    onChange={(event) =>
                      setEditFormState((current) =>
                        current
                          ? {
                              ...current,
                              status: event.target.value as FamilyPerson["status"],
                              deathDate:
                                event.target.value === "deceased"
                                  ? current.deathDate
                                  : "",
                            }
                          : current,
                      )
                    }
                    value={editFormState.status}
                  >
                    <option value="living">Жив</option>
                    <option value="deceased">Умер</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Дата смерти</span>
                  <input
                    disabled={editFormState.status !== "deceased"}
                    onChange={(event) =>
                      setEditFormState((current) =>
                        current
                          ? { ...current, deathDate: event.target.value }
                          : current,
                      )
                    }
                    placeholder="Если человек умер"
                    value={editFormState.deathDate}
                  />
                </label>
              </div>

              <label className="form-field">
                <span>Биография</span>
                <textarea
                  onChange={(event) =>
                    setEditFormState((current) =>
                      current
                        ? { ...current, biography: event.target.value }
                        : current,
                    )
                  }
                  rows={4}
                  value={editFormState.biography}
                />
              </label>

              <label className="form-field">
                <span>Заметка</span>
                <textarea
                  onChange={(event) =>
                    setEditFormState((current) =>
                      current
                        ? { ...current, note: event.target.value }
                        : current,
                    )
                  }
                  rows={3}
                  value={editFormState.note}
                />
              </label>

              <div className="chip-row">
                <span className="status-chip active">
                  Проверка дублей при обновлении карточки
                </span>
                <span className="status-chip">
                  Родственные связи сохраняются без изменений
                </span>
              </div>

              {errorMessage ? <p className="form-message error" role="alert">{errorMessage}</p> : null}

              <div className="form-actions">
                <button className="primary-button" disabled={isSubmitting || isPending} type="submit">
                  {isSubmitting ? "Сохраняем..." : "Сохранить изменения"}
                </button>
                <button className="ghost-button" onClick={closeSheet} type="button">
                  Отмена
                </button>
              </div>
              </fieldset>
            </form>
          </SheetShell>
        ) : activeSheet === "media" && draftPerson ? (
          <SheetShell
            description="Файл сохранится на диск в uploads и попадет в карточку человека как часть медиаархива."
            eyebrow="Медиаархив"
            onClose={closeSheet}
            title="Загрузить фото или голосовой файл"
          >
            <form className="form-stack" onSubmit={handleUploadMediaSubmit}>
              <fieldset className="story-form-fields form-stack" disabled={isSubmitting || isPending}>
              <div className="form-grid">
                <label className="form-field">
                  <span>Тип файла</span>
                  <select
                    className="form-select"
                    onChange={(event) =>
                      setUploadMediaState((current) => ({
                        ...current,
                        type: event.target.value as "photo" | "audio",
                      }))
                    }
                    value={uploadMediaState.type}
                  >
                    <option value="photo">Фотография</option>
                    <option value="audio">Голосовой / аудио</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Файл</span>
                  <input
                    accept={
                      uploadMediaState.type === "photo"
                        ? "image/jpeg,image/png,image/webp,image/gif"
                        : "audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/webm,audio/mp4"
                    }
                    onChange={(event) =>
                      setUploadMediaState((current) => ({
                        ...current,
                        file: event.target.files?.[0] ?? null,
                      }))
                    }
                    type="file"
                  />
                </label>
              </div>

              <div className="chip-row">
                <span className="status-chip active">
                  Фото до 10 MB, аудио до 20 MB
                </span>
                <span className="status-chip">
                  Файл будет привязан к текущему человеку
                </span>
              </div>

              {uploadMediaState.file ? (
                <div className="upload-preview">
                  <strong>{uploadMediaState.file.name}</strong>
                  <span>{Math.round(uploadMediaState.file.size / 1024)} KB</span>
                </div>
              ) : null}

              {errorMessage ? <p className="form-message error">{errorMessage}</p> : null}

              <div className="form-actions">
                <button className="primary-button" disabled={isSubmitting || isPending} type="submit">
                  {isSubmitting ? "Загружаем..." : "Загрузить файл"}
                </button>
                <button className="ghost-button" onClick={closeSheet} type="button">
                  Отмена
                </button>
              </div>
              </fieldset>
            </form>
          </SheetShell>
        ) : activeSheet === "story" && storyEditor ? (
          <StoryChangeDialog key={storyEditor.instance} slug={family.slug} subject={storyEditor.person} mode={storyEditor.mode} story={storyEditor.story}
            onClose={closeSheet} onDirtyChange={setChildDirty} onBusyChange={setChildBusy}
            onRefresh={() => startTransition(() => router.refresh())}
            onSuccess={(result) => { bypass(); discardSheet(); setStoryFocusRevision((revision) => revision + 1); setSuccessMessage(result.message ?? "История сохранена."); }} />
        ) : null
      }
      feedbackMessage={successMessage}
    />
  );
}
