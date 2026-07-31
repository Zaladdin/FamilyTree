import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const families = await prisma.family.findMany({ select: { id: true, slug: true } });

  // Old families created before slugs were transliterated have non-ASCII
  // (Cyrillic) slugs and cannot be opened by URL. Remove them so you can start
  // clean; cascading deletes also remove their memberships, tasks and logs.
  const broken = families.filter((f) => /[^\x00-\x7F]/.test(f.slug));

  if (!broken.length) {
    console.log("Нет семей с нелатинскими слагами — чистить нечего.");
    return;
  }

  for (const f of broken) {
    await prisma.family.delete({ where: { id: f.id } });
    console.log(`Удалена семья: slug="${f.slug}" id=${f.id}`);
  }

  console.log(`\nГотово. Удалено семей: ${broken.length}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
