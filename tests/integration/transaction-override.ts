import type { PrismaClient } from "@prisma/client";

/** Prisma exposes methods through a proxy whose descriptors lack method values.
 * Assign through the proxy instead of using node:test's descriptor-based mock.
 * Wrappers can still call the captured original to use real transactions.
 */
export function overrideTransaction(
  t: { after: (cleanup: () => void) => void },
  prisma: PrismaClient,
  replacement: PrismaClient["$transaction"],
) {
  const original = prisma.$transaction;
  let restored = false;
  const restore = () => {
    if (restored) return;
    prisma.$transaction = original;
    restored = true;
  };
  t.after(restore);
  prisma.$transaction = replacement;
  return restore;
}
