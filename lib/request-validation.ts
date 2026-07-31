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

const MIN_YEAR = 1000;
const MAX_YEAR = new Date().getFullYear() + 1;

type ParsedDate = {
  value: string;
  sortKey: number;
};

// Accepts common human date formats used for genealogy:
//   YYYY, YYYY-MM, YYYY-MM-DD, DD.MM.YYYY, MM.YYYY
// Returns the trimmed value plus a numeric sort key for ordering / comparison.
function parseHumanDate(raw: string, fieldName: string): ParsedDate {
  const value = raw.trim();

  let year: number | null = null;
  let month: number | null = null;
  let day: number | null = null;

  const isoMatch = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value);
  const dottedMatch = /^(?:(\d{2})\.)?(?:(\d{2})\.)?(\d{4})$/.exec(value);

  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = isoMatch[2] ? Number(isoMatch[2]) : null;
    day = isoMatch[3] ? Number(isoMatch[3]) : null;
  } else if (dottedMatch) {
    year = Number(dottedMatch[3]);
    // dd.mm.yyyy → groups [dd, mm, yyyy]; mm.yyyy → [undefined, mm, yyyy]
    if (dottedMatch[1] && dottedMatch[2]) {
      day = Number(dottedMatch[1]);
      month = Number(dottedMatch[2]);
    } else if (dottedMatch[2]) {
      month = Number(dottedMatch[2]);
    }
  } else {
    throw new HttpError(
      400,
      `Поле "${fieldName}" должно быть датой в формате ГГГГ, ГГГГ-ММ-ДД или ДД.ММ.ГГГГ.`,
    );
  }

  if (year === null || year < MIN_YEAR || year > MAX_YEAR) {
    throw new HttpError(400, `Год в поле "${fieldName}" вне допустимого диапазона.`);
  }

  if (month !== null && (month < 1 || month > 12)) {
    throw new HttpError(400, `Месяц в поле "${fieldName}" указан неверно.`);
  }

  if (day !== null) {
    const daysInMonth = month !== null ? new Date(year, month, 0).getDate() : 31;

    if (day < 1 || day > daysInMonth) {
      throw new HttpError(400, `День в поле "${fieldName}" указан неверно.`);
    }
  }

  const sortKey = year * 10000 + (month ?? 0) * 100 + (day ?? 0);

  return { value, sortKey };
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
    birthPlace: requireString(payload.birthPlace, "Место рождения", 255),
    biography: optionalString(payload.biography, "Биография", 6000),
    relationshipKind: parseRelationshipKind(payload.relationshipKind),
    relativePersonId: optionalString(payload.relativePersonId, "Родственник", 120),
  };
}

export function parseUpdatePersonInput(data: unknown): UpdatePersonInput {
  if (!data || typeof data !== "object") {
    throw new HttpError(400, "Некорректный payload для обновления человека.");
  }

  const payload = data as Record<string, unknown>;
  const status = parsePersonStatus(payload.status);
  const birthDate = parseHumanDate(
    requireString(payload.birthDate, "Дата рождения", 120),
    "Дата рождения",
  );
  const deathDate =
    status === "deceased"
      ? parseHumanDate(
          requireString(payload.deathDate, "Дата смерти", 120),
          "Дата смерти",
        )
      : null;

  if (deathDate) {
    const birthYear = Math.floor(birthDate.sortKey / 10000);
    const deathYear = Math.floor(deathDate.sortKey / 10000);
    const bothHaveMonth =
      birthDate.sortKey % 10000 !== 0 && deathDate.sortKey % 10000 !== 0;

    const deathBeforeBirth =
      deathYear < birthYear ||
      (deathYear === birthYear && bothHaveMonth && deathDate.sortKey < birthDate.sortKey);

    if (deathBeforeBirth) {
      throw new HttpError(400, "Дата смерти не может быть раньше даты рождения.");
    }
  }

  return {
    firstName: requireString(payload.firstName, "Имя", 120),
    lastName: requireString(payload.lastName, "Фамилия", 120),
    middleName: optionalString(payload.middleName, "Отчество", 120),
    gender: parseGender(payload.gender),
    birthDate: birthDate.value,
    birthPlace: requireString(payload.birthPlace, "Место рождения", 255),
    biography: optionalString(payload.biography, "Биография", 6000),
    note: optionalString(payload.note, "Заметка", 4000),
    status,
    deathDate: deathDate ? deathDate.value : "",
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

// CSRF defense-in-depth on top of SameSite=Lax cookies: browsers attach an
// Origin header to cross-site POST/PATCH/DELETE requests, so a mismatch means
// the request was forged from another site. Requests without an Origin header
// (curl, server-to-server) are allowed — they cannot carry a victim browser's
// cookies, which is the only thing CSRF exploits.
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");

  if (origin && origin !== new URL(request.url).origin) {
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
