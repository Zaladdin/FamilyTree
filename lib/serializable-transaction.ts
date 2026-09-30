import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";

/** Retry the entire read/validate/write unit; callbacks must have no external side effects. */
export async function withSerializableTransaction<T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  options: { retryUnique?: boolean } = {},
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const conflict = error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || (options.retryUnique === true && error.code === "P2002"));
      if (!conflict) throw error;
      if (attempt === 2) {
        throw new HttpError(409, "Данные изменились во время сохранения. Обновите страницу и повторите действие.");
      }
    }
  }
  throw new Error("Unreachable transaction retry state");
}
