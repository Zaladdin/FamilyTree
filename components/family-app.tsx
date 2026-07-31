"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AddPersonInput,
  AddRelationshipKind,
  UpdatePersonInput,
} from "@/lib/family-logic";
import { Family, FamilyPerson, Gender, MediaAsset } from "@/lib/types";
import { FamilyWorkspace } from "@/components/family-workspace";

type FamilyAppProps = {
  canEdit: boolean;
  initialFamily: Family;
  initialFocusPersonId: string;
};

type AddFormState = {
  firstName: string;
  lastName: string;
  middleName: string;
  gender: Gender;
  birthDate: string;
  birthPlace: string;
  biography: string;
  relationshipKind: AddRelationshipKind;
  relativePersonId: string;
};

type EditFormState = {
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
};

type UploadMediaState = {
  type: "photo" | "audio";
  file: File | null;
};

type StoryFormState = {
  title: string;
  narrator: string;
  body: string;
};

const initialAddFormState = (
  focusPersonId: string,
  relationshipKind: AddRelationshipKind = "child",
): AddFormState => ({
  firstName: "",
  lastName: "",
  middleName: "",
  gender: "female",
  birthDate: "",
  birthPlace: "",
  biography: "",
  relationshipKind,
  relativePersonId: focusPersonId,
});

const initialEditFormState = (person: FamilyPerson): EditFormState => ({
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
  const [activeSheet, setActiveSheet] = useState<"add" | "edit" | "media" | "story" | null>(null);
  const [addFormState, setAddFormState] = useState(() =>
    initialAddFormState(initialFocusPersonId),
  );
  const [editFormState, setEditFormState] = useState<EditFormState | null>(null);
  const [uploadMediaState, setUploadMediaState] = useState<UploadMediaState>({
    type: "photo",
    file: null,
  });
  const [storyFormState, setStoryFormState] = useState<StoryFormState>({
    title: "",
    narrator: "",
    body: "",
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const family = initialFamily;
  const focusPersonId = initialFocusPersonId;
  const focusPerson =
    family.people.find((person) => person.id === focusPersonId) ?? family.people[0];

  function syncFocus(nextFocusPersonId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("person", nextFocusPersonId);

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  function closeSheet() {
    setActiveSheet(null);
    setErrorMessage("");
  }

  function handleOpenAddPerson() {
    setActiveSheet("add");
    setErrorMessage("");
    setSuccessMessage("");
    setAddFormState(initialAddFormState(focusPersonId));
  }

  function handleZoomIn() {
    setCanvasScale((current) => Math.min(1.2, Number((current + 0.08).toFixed(2))));
  }

  function handleZoomOut() {
    setCanvasScale((current) => Math.max(0.82, Number((current - 0.08).toFixed(2))));
  }

  function handleResetZoom() {
    setCanvasScale(1);
  }

  function handleScaleChange(nextScale: number) {
    setCanvasScale(Number(nextScale.toFixed(2)));
  }

  function handleOpenEditPerson() {
    setActiveSheet("edit");
    setErrorMessage("");
    setSuccessMessage("");
    setEditFormState(initialEditFormState(focusPerson));
  }

  function handleOpenUploadMedia() {
    setActiveSheet("media");
    setErrorMessage("");
    setSuccessMessage("");
    setUploadMediaState({
      type: "photo",
      file: null,
    });
  }

  function handleOpenCreateStory() {
    setActiveSheet("story");
    setErrorMessage("");
    setSuccessMessage("");
    setStoryFormState({
      title: "",
      narrator: "",
      body: "",
    });
  }

  async function handleAddSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");
    setIsSubmitting(true);

    const payload: AddPersonInput = {
      firstName: addFormState.firstName,
      lastName: addFormState.lastName,
      middleName: addFormState.middleName,
      gender: addFormState.gender,
      birthDate: addFormState.birthDate,
      birthPlace: addFormState.birthPlace,
      biography: addFormState.biography,
      relationshipKind: addFormState.relationshipKind,
      relativePersonId: addFormState.relativePersonId,
    };

    try {
      const response = await fetch(`/api/family/${family.slug}/people`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = (await response.json()) as ApiResponse;

      if (!response.ok || !result.personId) {
        throw new Error(result.error ?? "Не удалось добавить человека.");
      }

      setAddFormState(initialAddFormState(result.personId));
      setActiveSheet(null);
      setSuccessMessage(result.message ?? "Человек добавлен.");

      const params = new URLSearchParams(searchParams.toString());
      params.set("person", result.personId);

      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
        router.refresh();
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Не удалось добавить человека.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleEditSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editFormState) {
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");
    setIsSubmitting(true);

    const payload: UpdatePersonInput = {
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

    try {
      const response = await fetch(
        `/api/family/${family.slug}/people/${focusPerson.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      const result = (await response.json()) as ApiResponse;

      if (!response.ok || !result.personId) {
        throw new Error(result.error ?? "Не удалось обновить карточку человека.");
      }

      setActiveSheet(null);
      setSuccessMessage(result.message ?? "Карточка обновлена.");

      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Не удалось обновить карточку человека.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUploadMediaSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    if (!uploadMediaState.file) {
      setErrorMessage("Сначала выбери файл для загрузки.");
      return;
    }

    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append("type", uploadMediaState.type);
      formData.append("file", uploadMediaState.file);

      const response = await fetch(
        `/api/family/${family.slug}/people/${focusPerson.id}/media`,
        {
          method: "POST",
          body: formData,
        },
      );

      const result = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(result.error ?? "Не удалось загрузить файл.");
      }

      setActiveSheet(null);
      setUploadMediaState({
        type: "photo",
        file: null,
      });
      setSuccessMessage(result.message ?? "Файл добавлен.");

      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить файл.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteMedia(asset: MediaAsset) {
    setErrorMessage("");
    setSuccessMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch(
        `/api/family/${family.slug}/people/${focusPerson.id}/media/${asset.id}`,
        {
          method: "DELETE",
        },
      );

      const result = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(result.error ?? "Не удалось удалить медиафайл.");
      }

      setSuccessMessage(result.message ?? "Медиафайл удален.");

      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Не удалось удалить медиафайл.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleArchivePerson() {
    setErrorMessage("");
    setSuccessMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch(
        `/api/family/${family.slug}/people/${focusPerson.id}/archive`,
        {
          method: "POST",
        },
      );

      const result = (await response.json()) as ApiResponse;

      if (!response.ok || !result.personId) {
        throw new Error(result.error ?? "Не удалось архивировать человека.");
      }

      const nextPerson =
        family.people.find((person) => person.id !== focusPerson.id) ?? family.people[0];

      if (!nextPerson || nextPerson.id === focusPerson.id) {
        throw new Error("Не удалось подобрать новый фокус дерева после архивации.");
      }

      setSuccessMessage(result.message ?? "Человек архивирован.");

      const params = new URLSearchParams(searchParams.toString());
      params.set("person", nextPerson.id);

      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
        router.refresh();
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Не удалось архивировать человека.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateStorySubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch(
        `/api/family/${family.slug}/people/${focusPerson.id}/stories`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(storyFormState),
        },
      );

      const result = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(result.error ?? "Не удалось добавить историю.");
      }

      setActiveSheet(null);
      setStoryFormState({
        title: "",
        narrator: "",
        body: "",
      });
      setSuccessMessage(result.message ?? "История добавлена.");

      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось добавить историю.");
    } finally {
      setIsSubmitting(false);
    }
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
      onOpenEditPerson={canEdit ? handleOpenEditPerson : undefined}
      onOpenUploadMedia={canEdit ? handleOpenUploadMedia : undefined}
      onOpenCreateStory={canEdit ? handleOpenCreateStory : undefined}
      onDeleteMedia={canEdit ? handleDeleteMedia : undefined}
      onArchivePerson={canEdit ? handleArchivePerson : undefined}
      addPersonSheet={
        activeSheet === "add" ? (
          <SheetShell
            description="Создайте нового человека и сразу привяжите его к уже существующему родственнику."
            eyebrow="Новый человек"
            onClose={closeSheet}
            title="Добавить человека и связь"
          >
            <form className="form-stack" onSubmit={handleAddSubmit}>
              <div className="form-grid">
                <label className="form-field">
                  <span>Имя</span>
                  <input
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

              <div className="form-grid">
                <label className="form-field">
                  <span>Отчество</span>
                  <input
                    onChange={(event) =>
                      setAddFormState((current) => ({
                        ...current,
                        middleName: event.target.value,
                      }))
                    }
                    value={addFormState.middleName}
                  />
                </label>
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
              </div>

              <div className="form-grid">
                <label className="form-field">
                  <span>Дата рождения</span>
                  <input
                    onChange={(event) =>
                      setAddFormState((current) => ({
                        ...current,
                        birthDate: event.target.value,
                      }))
                    }
                    placeholder="Например, 2026 или 14.03.1991"
                    required
                    value={addFormState.birthDate}
                  />
                </label>
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
              </div>

              {family.people.length > 0 ? (
              <div className="form-grid">
                <label className="form-field">
                  <span>Кем приходится выбранному человеку</span>
                  <select
                    className="form-select"
                    onChange={(event) =>
                      setAddFormState((current) => ({
                        ...current,
                        relationshipKind: event.target.value as AddRelationshipKind,
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
                  <span>Относительно кого создать связь</span>
                  <select
                    className="form-select"
                    onChange={(event) =>
                      setAddFormState((current) => ({
                        ...current,
                        relativePersonId: event.target.value,
                      }))
                    }
                    value={addFormState.relativePersonId}
                  >
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

              <label className="form-field">
                <span>Краткая биография</span>
                <textarea
                  onChange={(event) =>
                    setAddFormState((current) => ({
                      ...current,
                      biography: event.target.value,
                    }))
                  }
                  rows={4}
                  value={addFormState.biography}
                />
              </label>

              <div className="chip-row">
                <span className="status-chip active">
                  Проверка дублей по ФИО и дате рождения
                </span>
                <span className="status-chip">
                  После добавления дерево обновится сразу
                </span>
              </div>

              {errorMessage ? <p className="form-message error">{errorMessage}</p> : null}

              <div className="form-actions">
                <button className="primary-button" disabled={isSubmitting || isPending} type="submit">
                  {isSubmitting ? "Сохраняем..." : "Добавить человека"}
                </button>
                <button className="ghost-button" onClick={closeSheet} type="button">
                  Отмена
                </button>
              </div>
            </form>
          </SheetShell>
        ) : activeSheet === "edit" && editFormState ? (
          <SheetShell
            description="Изменения сохраняются в базу и сразу отражаются в карточке человека и дереве."
            eyebrow="Редактирование"
            onClose={closeSheet}
            title="Редактировать карточку человека"
          >
            <form className="form-stack" onSubmit={handleEditSubmit}>
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

              {errorMessage ? <p className="form-message error">{errorMessage}</p> : null}

              <div className="form-actions">
                <button className="primary-button" disabled={isSubmitting || isPending} type="submit">
                  {isSubmitting ? "Сохраняем..." : "Сохранить изменения"}
                </button>
                <button className="ghost-button" onClick={closeSheet} type="button">
                  Отмена
                </button>
              </div>
            </form>
          </SheetShell>
        ) : activeSheet === "media" ? (
          <SheetShell
            description="Файл сохранится на диск в uploads и попадет в карточку человека как часть медиаархива."
            eyebrow="Медиаархив"
            onClose={closeSheet}
            title="Загрузить фото или голосовой файл"
          >
            <form className="form-stack" onSubmit={handleUploadMediaSubmit}>
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
            </form>
          </SheetShell>
        ) : activeSheet === "story" ? (
          <SheetShell
            description="История будет сохранена в карточке человека и станет частью семейной памяти."
            eyebrow="История"
            onClose={closeSheet}
            title="Добавить историю или легенду"
          >
            <form className="form-stack" onSubmit={handleCreateStorySubmit}>
              <label className="form-field">
                <span>Заголовок</span>
                <input
                  onChange={(event) =>
                    setStoryFormState((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  required
                  value={storyFormState.title}
                />
              </label>

              <label className="form-field">
                <span>Рассказчик</span>
                <input
                  onChange={(event) =>
                    setStoryFormState((current) => ({
                      ...current,
                      narrator: event.target.value,
                    }))
                  }
                  placeholder="Например, Ахмед Магомедов"
                  value={storyFormState.narrator}
                />
              </label>

              <label className="form-field">
                <span>Текст истории</span>
                <textarea
                  onChange={(event) =>
                    setStoryFormState((current) => ({
                      ...current,
                      body: event.target.value,
                    }))
                  }
                  required
                  rows={6}
                  value={storyFormState.body}
                />
              </label>

              <div className="chip-row">
                <span className="status-chip active">
                  История привяжется к текущему человеку
                </span>
                <span className="status-chip">
                  Событие сохранится в журнале изменений
                </span>
              </div>

              {errorMessage ? <p className="form-message error">{errorMessage}</p> : null}

              <div className="form-actions">
                <button className="primary-button" disabled={isSubmitting || isPending} type="submit">
                  {isSubmitting ? "Сохраняем..." : "Добавить историю"}
                </button>
                <button className="ghost-button" onClick={closeSheet} type="button">
                  Отмена
                </button>
              </div>
            </form>
          </SheetShell>
        ) : null
      }
      feedbackMessage={successMessage}
    />
  );
}
