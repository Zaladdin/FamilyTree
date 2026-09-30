import { MAX_ADDITIONAL_RELATIONSHIPS, type AddPersonInput, type AddRelationshipKind, type PersonRelationshipInput, type PersonUpdateRequest, type UpdatePersonInput } from "@/lib/family-logic";
import { Gender } from "@/lib/types";
import { HttpError } from "@/lib/http-error";
import { getRequestOrigin } from "@/lib/request-origin";
import { normalizeMultilineText } from "@/lib/content-text";

function multilineString(value: unknown, fieldName: string, maxLength: number, required = false) {
  if (!required && (value === undefined || value === null)) return "";
  if (typeof value !== "string") throw new HttpError(400, `Поле "${fieldName}" должно быть строкой.`);
  const normalized = normalizeMultilineText(value);
  if (required && !normalized) throw new HttpError(400, `Поле "${fieldName}" обязательно.`);
  if (normalized.length > maxLength) throw new HttpError(400, `Поле "${fieldName}" слишком длинное.`);
  return normalized;
}

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

const MIN_YEAR = 1000;
const MAX_YEAR = new Date().getFullYear() + 1;

type ParsedDate = {
  value: string;
  earliestKey: number;
  latestKey: number;
};

// Accepts common human date formats used for genealogy:
//   YYYY, YYYY-MM, YYYY-MM-DD, DD.MM.YYYY, MM.YYYY
// Partial dates represent an interval; unknown months/days are not exact dates.
function parseHumanDate(raw: string, fieldName: string): ParsedDate {
  const value = raw.trim();

  let year: number | null = null;
  let month: number | null = null;
  let day: number | null = null;

  const isoMatch = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value);
  const dottedMatch = /^(?:(\d{2})\.)?(\d{2})\.(\d{4})$/.exec(value);

  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = isoMatch[2] ? Number(isoMatch[2]) : null;
    day = isoMatch[3] ? Number(isoMatch[3]) : null;
  } else if (dottedMatch) {
    year = Number(dottedMatch[3]);
    day = dottedMatch[1] ? Number(dottedMatch[1]) : null;
    month = Number(dottedMatch[2]);
  } else {
    throw new HttpError(
      400,
      `Поле "${fieldName}" должно быть датой в формате ГГГГ, ГГГГ-ММ, ГГГГ-ММ-ДД, ММ.ГГГГ или ДД.ММ.ГГГГ.`,
    );
  }

  if (year === null || year < MIN_YEAR || year > MAX_YEAR) {
    throw new HttpError(400, `Год в поле "${fieldName}" вне допустимого диапазона.`);
  }

  if (month !== null && (month < 1 || month > 12)) {
    throw new HttpError(400, `Месяц в поле "${fieldName}" указан неверно.`);
  }

  if (day !== null) {
    const daysInMonth = new Date(Date.UTC(year, month ?? 12, 0)).getUTCDate();

    if (day < 1 || day > daysInMonth) {
      throw new HttpError(400, `День в поле "${fieldName}" указан неверно.`);
    }
  }

  const earliestKey = year * 10000 + (month ?? 1) * 100 + (day ?? 1);
  const lastDay = new Date(Date.UTC(year, month ?? 12, 0)).getUTCDate();
  const latestKey = year * 10000 + (month ?? 12) * 100 + (day ?? lastDay);

  return { value, earliestKey, latestKey };
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

function parseDeathDate(status: UpdatePersonInput["status"], raw: unknown, birthDate: ParsedDate) {
  if (status !== "deceased") return "";
  const deathDate = parseHumanDate(requireString(raw, "Дата смерти", 120), "Дата смерти");
  if (deathDate.latestKey < birthDate.earliestKey) {
    throw new HttpError(400, "Дата смерти не может быть раньше даты рождения.");
  }
  return deathDate.value;
}

export function parseAddPersonInput(data: unknown, options: { allowDraftReferences?: boolean } = {}): AddPersonInput {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError(400, "Некорректный payload для создания человека.");
  }

  const payload = data as Record<string, unknown>;
  if (!options.allowDraftReferences && payload.relativeClientId !== undefined && payload.relativeClientId !== "") {
    throw new HttpError(400, "Связь с карточкой списка доступна только при добавлении нескольких людей.");
  }
  const relationshipKind = parseRelationshipKind(payload.relationshipKind);
  const status = payload.status === undefined ? "living" : parsePersonStatus(payload.status);
  let additionalRelationships: PersonRelationshipInput[] | undefined;
  if (payload.additionalRelationships !== undefined) {
    if (!Array.isArray(payload.additionalRelationships) || payload.additionalRelationships.length > MAX_ADDITIONAL_RELATIONSHIPS) {
      throw new HttpError(400, `Можно указать не более ${MAX_ADDITIONAL_RELATIONSHIPS + 1} связей для одного человека.`);
    }
    additionalRelationships = payload.additionalRelationships.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new HttpError(400, "Некорректная дополнительная родственная связь.");
      }
      const link = raw as Record<string, unknown>;
      const relativePersonId = optionalString(link.relativePersonId, "Родственник", 120);
      const relativeClientId = optionalString(link.relativeClientId, "Карточка родственника", 120);
      if (relativeClientId && !options.allowDraftReferences) {
        throw new HttpError(400, "Связь с карточкой списка доступна только при добавлении нескольких людей.");
      }
      if (Number(Boolean(relativePersonId)) + Number(Boolean(relativeClientId)) !== 1) {
        throw new HttpError(400, "Выберите ровно одного родственника для каждой связи.");
      }
      return {
        relationshipKind: parseRelationshipKind(link.relationshipKind), relativePersonId,
        ...(relativeClientId ? { relativeClientId } : {}),
      };
    });
  }
  let sharedChildIds: string[] | undefined;
  if (payload.sharedChildIds !== undefined) {
    if (!Array.isArray(payload.sharedChildIds) || payload.sharedChildIds.length > 100) {
      throw new HttpError(400, "Некорректный список общих детей.");
    }
    sharedChildIds = [...new Set(payload.sharedChildIds.map((id) => requireString(id, "Общий ребёнок", 120)))];
    if (sharedChildIds.length && relationshipKind !== "spouse") {
      throw new HttpError(400, "Общих детей можно указать только при добавлении супруга или супруги.");
    }
  }
  const birthDate = parseHumanDate(
    requireString(payload.birthDate, "Дата рождения", 120),
    "Дата рождения",
  );

  return {
    firstName: requireString(payload.firstName, "Имя", 120),
    lastName: requireString(payload.lastName, "Фамилия", 120),
    middleName: optionalString(payload.middleName, "Отчество", 120),
    gender: parseGender(payload.gender),
    birthDate: birthDate.value,
    status,
    deathDate: parseDeathDate(status, payload.deathDate, birthDate),
    birthPlace: requireString(payload.birthPlace, "Место рождения", 255),
    biography: multilineString(payload.biography, "Биография", 6000),
    relationshipKind,
    relativePersonId: optionalString(payload.relativePersonId, "Родственник", 120),
    ...(sharedChildIds !== undefined ? { sharedChildIds } : {}),
    ...(additionalRelationships !== undefined ? { additionalRelationships } : {}),
  };
}

export function parseUpdatePersonInput(data: unknown): PersonUpdateRequest {
  if (!data || typeof data !== "object") {
    throw new HttpError(400, "Некорректный payload для обновления человека.");
  }

  const payload = data as Record<string, unknown>;
  const expectedVersion = payload.expectedVersion;
  if (typeof expectedVersion !== "number" || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw new HttpError(400, "Не указана корректная версия карточки. Обновите карточку перед редактированием.");
  }
  const status = parsePersonStatus(payload.status);
  const birthDate = parseHumanDate(
    requireString(payload.birthDate, "Дата рождения", 120),
    "Дата рождения",
  );
  const deathDate = parseDeathDate(status, payload.deathDate, birthDate);

  return {
    expectedVersion,
    firstName: requireString(payload.firstName, "Имя", 120),
    lastName: requireString(payload.lastName, "Фамилия", 120),
    middleName: optionalString(payload.middleName, "Отчество", 120),
    gender: parseGender(payload.gender),
    birthDate: birthDate.value,
    birthPlace: requireString(payload.birthPlace, "Место рождения", 255),
    biography: multilineString(payload.biography, "Биография", 6000),
    note: multilineString(payload.note, "Заметка", 4000),
    status,
    deathDate,
  };
}

export function parseCreateStoryInput(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError(400, "Некорректный payload для создания истории.");
  }

  const payload = data as Record<string, unknown>;

  return {
    title: requireString(payload.title, "Заголовок истории", 160),
    body: multilineString(payload.body, "Текст истории", 12000, true),
    narrator: optionalString(payload.narrator, "Рассказчик", 160),
  };
}

export function parseStoryVersionInput(data: unknown): { expectedVersion: number } {
  const version = data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>).expectedVersion : undefined;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) {
    throw new HttpError(400, "Передайте текущую версию истории.");
  }
  return { expectedVersion: version };
}

export function parseUpdateStoryInput(data: unknown) {
  return { ...parseCreateStoryInput(data), ...parseStoryVersionInput(data) };
}

// CSRF defense-in-depth on top of SameSite=Lax cookies: browsers attach an
// Origin header to cross-site POST/PATCH/DELETE requests, so a mismatch means
// the request was forged from another site. Requests without an Origin header
// (curl, server-to-server) are allowed — they cannot carry a victim browser's
// cookies, which is the only thing CSRF exploits.
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");

  if (origin && origin !== getRequestOrigin(request)) {
    throw new HttpError(403, "Запрос отклонен: недопустимый источник запроса.");
  }
}

export function parseAuthFormField(value: FormDataEntryValue | null, fieldName: string) {
  return requireString(value, fieldName, 255);
}

// Passwords must be preserved verbatim: no trimming or whitespace collapsing,
// which would silently alter what the user typed.
export function parseAuthPassword(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    throw new HttpError(400, 'Поле "Пароль" должно быть строкой.');
  }

  if (value.length === 0) {
    throw new HttpError(400, 'Поле "Пароль" обязательно.');
  }

  if (value.length > 200) {
    throw new HttpError(400, "Пароль слишком длинный (максимум 200 символов).");
  }

  return value;
}
