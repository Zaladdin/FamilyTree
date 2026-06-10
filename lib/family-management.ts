import { HttpError } from "@/lib/http-error";

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function slugify(value: string) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

export type CreateFamilyInput = {
  title: string;
  surname: string;
  region: string;
  description: string;
};

function requireString(value: unknown, fieldName: string, maxLength = 255) {
  if (typeof value !== "string") {
    throw new HttpError(400, `Поле "${fieldName}" должно быть строкой.`);
  }

  const normalized = normalizeText(value);

  if (!normalized) {
    throw new HttpError(400, `Поле "${fieldName}" обязательно.`);
  }

  if (normalized.length > maxLength) {
    throw new HttpError(400, `Поле "${fieldName}" слишком длинное.`);
  }

  return normalized;
}

export function parseCreateFamilyInput(data: unknown): CreateFamilyInput {
  if (!data || typeof data !== "object") {
    throw new HttpError(400, "Некорректный payload для создания семьи.");
  }

  const payload = data as Record<string, unknown>;

  return {
    title: requireString(payload.title, "Название семьи", 120),
    surname: requireString(payload.surname, "Фамилия рода", 120),
    region: requireString(payload.region, "Регион", 255),
    description: requireString(payload.description, "Описание", 6000),
  };
}

export function buildFamilySlug(title: string, surname: string) {
  return slugify(surname) || slugify(title) || "family";
}
