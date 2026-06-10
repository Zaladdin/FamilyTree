import { AddPersonInput, AddRelationshipKind, UpdatePersonInput } from "@/lib/family-logic";
import { Gender } from "@/lib/types";
import { HttpError } from "@/lib/http-error";

function requireString(value: unknown, fieldName: string, maxLength = 4000) {
  if (typeof value !== "string") {
    throw new HttpError(400, `Поле "${fieldName}" должно быть строкой.`);
  }

  const normalized = value.trim().replace(/\s+/g, " ");

  if (!normalized) {
    throw new HttpError(400, `Поле "${fieldName}" обязательно.`);
  }

  if (normalized.length > maxLength) {
    throw new HttpError(400, `Поле "${fieldName}" слишком длинное.`);
  }

  return normalized;
}

function optionalString(value: unknown, fieldName: string, maxLength = 4000) {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  if (typeof value !== "string") {
    throw new HttpError(400, `Поле "${fieldName}" должно быть строкой.`);
  }

  const normalized = value.trim().replace(/\s+/g, " ");

  if (normalized.length > maxLength) {
    throw new HttpError(400, `Поле "${fieldName}" слишком длинное.`);
  }

  return normalized;
}

function parseGender(value: unknown): Gender {
  if (value !== "male" && value !== "female") {
    throw new HttpError(400, "Пол должен быть male или female.");
  }

  return value;
}

function parseRelationshipKind(value: unknown): AddRelationshipKind {
  if (value !== "parent" && value !== "child" && value !== "spouse" && value !== "sibling") {
    throw new HttpError(400, "Некорректный тип родственной связи.");
  }

  return value;
}

function parsePersonStatus(value: unknown): UpdatePersonInput["status"] {
  if (value !== "living" && value !== "deceased") {
    throw new HttpError(400, "Статус человека должен быть living или deceased.");
  }

  return value;
}

export function parseAddPersonInput(data: unknown): AddPersonInput {
  if (!data || typeof data !== "object") {
    throw new HttpError(400, "Некорректный payload для создания человека.");
  }

  const payload = data as Record<string, unknown>;

  return {
    firstName: requireString(payload.firstName, "Имя", 120),
    lastName: requireString(payload.lastName, "Фамилия", 120),
    middleName: optionalString(payload.middleName, "Отчество", 120),
    gender: parseGender(payload.gender),
    birthDate: requireString(payload.birthDate, "Дата рождения", 120),
    birthPlace: requireString(payload.birthPlace, "Место рождения", 255),
    biography: optionalString(payload.biography, "Биография", 6000),
    relationshipKind: parseRelationshipKind(payload.relationshipKind),
    relativePersonId: requireString(payload.relativePersonId, "Родственник", 120),
  };
}

export function parseUpdatePersonInput(data: unknown): UpdatePersonInput {
  if (!data || typeof data !== "object") {
    throw new HttpError(400, "Некорректный payload для обновления человека.");
  }

  const payload = data as Record<string, unknown>;
  const status = parsePersonStatus(payload.status);

  return {
    firstName: requireString(payload.firstName, "Имя", 120),
    lastName: requireString(payload.lastName, "Фамилия", 120),
    middleName: optionalString(payload.middleName, "Отчество", 120),
    gender: parseGender(payload.gender),
    birthDate: requireString(payload.birthDate, "Дата рождения", 120),
    birthPlace: requireString(payload.birthPlace, "Место рождения", 255),
    biography: optionalString(payload.biography, "Биография", 6000),
    note: optionalString(payload.note, "Заметка", 4000),
    status,
    deathDate:
      status === "deceased"
        ? requireString(payload.deathDate, "Дата смерти", 120)
        : "",
  };
}

export function parseCreateStoryInput(data: unknown) {
  if (!data || typeof data !== "object") {
    throw new HttpError(400, "Некорректный payload для создания истории.");
  }

  const payload = data as Record<string, unknown>;

  return {
    title: requireString(payload.title, "Заголовок истории", 160),
    body: requireString(payload.body, "Текст истории", 12000),
    narrator: optionalString(payload.narrator, "Рассказчик", 160),
  };
}

export function parseAuthFormField(value: FormDataEntryValue | null, fieldName: string) {
  return requireString(value, fieldName, 255);
}
