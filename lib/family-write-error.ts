import { Prisma } from "@prisma/client";
import { HttpError } from "@/lib/http-error";
import { recordRequestFailure } from "@/lib/observability";

export const SIBLING_SCHEMA_NOT_READY_MESSAGE = "Для связи «брат / сестра» требуется обновление базы данных. Заполненные данные остались в форме. Обратитесь к администратору.";

function isMissingSiblingEnum(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientUnknownRequestError) &&
      !(error instanceof Prisma.PrismaClientKnownRequestError)) return false;

  const metadata = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta : undefined;
  const message = typeof metadata?.message === "string" ? metadata.message : error.message;
  // Prisma's connector diagnostic escapes the nested PostgreSQL message. Match
  // its exact enum/value and SQLSTATE, not arbitrary text mentioning siblings.
  const diagnostic = message.replaceAll('\\"', '"');
  const invalidEnum = diagnostic.includes('invalid input value for enum "RelationshipType": "sibling"');
  const invalidInput = metadata?.code === "22P02" || /\bcode:\s*"22P02"/.test(error.message);
  return invalidEnum && invalidInput;
}

/** Keep storage details private; only typed domain errors cross this boundary. */
export function familyWriteErrorResponse(
  error: unknown,
  messages: { fallback: string; invalidJson: string },
): { status: number; body: { error: string; code?: string } } {
  recordRequestFailure(error);
  if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
    return { status: error.status, body: { error: error.message } };
  }
  if (isMissingSiblingEnum(error)) {
    return { status: 503, body: { error: SIBLING_SCHEMA_NOT_READY_MESSAGE, code: "SIBLING_SCHEMA_NOT_READY" } };
  }
  if (error instanceof SyntaxError) return { status: 400, body: { error: messages.invalidJson } };
  return { status: 500, body: { error: messages.fallback } };
}
