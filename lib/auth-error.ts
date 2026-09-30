import { Prisma } from "@prisma/client";
import { HttpError } from "@/lib/http-error";
import { recordRequestFailure } from "@/lib/observability";

/** Only deliberate client-facing errors may be included in a redirect URL. */
export function authErrorMessage(error: unknown, fallback: string): string {
  recordRequestFailure(error);
  if (error instanceof HttpError && error.status >= 400 && error.status < 500) return error.message;
  const code = error instanceof Prisma.PrismaClientInitializationError
    ? error.errorCode
    : error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
  if (code && ["P1001", "P1002", "P1008", "P1017", "P2024"].includes(code)) {
    return "База данных временно недоступна. Подождите немного и попробуйте снова.";
  }
  return fallback;
}
