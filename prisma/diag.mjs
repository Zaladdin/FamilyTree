import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  const families = await prisma.family.findMany({
    select: { id: true, slug: true, title: true, surname: true, peopleCount: true },
  });
  const memberships = await prisma.familyMembership.findMany({
    select: { familyId: true, userId: true, role: true, name: true },
  });

  console.log("\n=== USERS ===");
  for (const u of users) console.log(`${u.id} | ${u.email} | ${u.firstName} ${u.lastName}`);

  console.log("\n=== FAMILIES ===");
  for (const f of families) console.log(`slug="${f.slug}" | id=${f.id} | "${f.title}" | people=${f.peopleCount}`);

  console.log("\n=== MEMBERSHIPS ===");
  for (const m of memberships) console.log(`familyId=${m.familyId} | userId=${m.userId} | role=${m.role} | ${m.name}`);

  console.log("");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
