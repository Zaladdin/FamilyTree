import { FamilyRole, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildFamilySlug, CreateFamilyInput } from "@/lib/family-management";
import { HttpError } from "@/lib/http-error";
import { UserFamilySummary } from "@/lib/types";

type CreateFamilyParams = {
  input: CreateFamilyInput;
  user: {
    id: string;
    firstName: string;
    lastName: string;
  };
};

async function createUniqueFamilySlug(baseSlug: string) {
  let candidate = baseSlug;
  let counter = 2;

  while (await prisma.family.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    candidate = `${baseSlug}-${counter}`;
    counter += 1;
  }

  return candidate;
}

export async function createFamilySpace({ input, user }: CreateFamilyParams) {
  const existingMemberships = await prisma.familyMembership.count({
    where: {
      userId: user.id,
      role: FamilyRole.owner,
    },
  });

  if (existingMemberships >= 10) {
    throw new HttpError(400, "На одном аккаунте пока можно создать не больше 10 семей.");
  }

  const baseSlug = buildFamilySlug(input.title, input.surname);
  const coverQuote = `Архив семьи ${input.surname}: люди, связи, истории, фотографии и голоса памяти в одном пространстве.`;
  const ownerName = `${user.firstName} ${user.lastName}`;

  // A unique slug is chosen up front, but two concurrent creates can still race
  // to the same value. Retry on the unique-constraint violation with a fresh
  // candidate instead of surfacing an unhandled error.
  const MAX_ATTEMPTS = 5;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const slug = await createUniqueFamilySlug(baseSlug);

    try {
      return await prisma.family.create({
        data: {
          id: `family-${slug}`,
          slug,
          title: input.title,
          surname: input.surname,
          description: input.description,
          region: input.region,
          coverQuote,
          contributorsCount: 1,
          memberships: {
            create: {
              userId: user.id,
              name: ownerName,
              role: FamilyRole.owner,
            },
          },
          digitizationTasks: {
            create: [
              {
                title: "Добавить первого человека в дерево",
                owner: ownerName,
                status: "planned",
              },
              {
                title: "Загрузить первые семейные фотографии",
                owner: ownerName,
                status: "planned",
              },
            ],
          },
          auditLogs: {
            create: {
              action: "person_created",
              actorName: ownerName,
              message: `${ownerName} создал(а) семейное пространство "${input.title}".`,
            },
          },
        },
        select: { slug: true },
      });
    } catch (error) {
      const isSlugCollision =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        attempt < MAX_ATTEMPTS - 1;

      if (!isSlugCollision) {
        throw error;
      }
    }
  }

  throw new HttpError(500, "Не удалось создать семейное пространство. Попробуйте ещё раз.");
}

export async function listFamiliesForUser(userId: string): Promise<UserFamilySummary[]> {
  const memberships = await prisma.familyMembership.findMany({
    where: {
      userId,
    },
    orderBy: [
      {
        family: {
          updatedAt: "desc",
        },
      },
    ],
    select: {
      role: true,
      family: {
        select: {
          id: true,
          slug: true,
          title: true,
          surname: true,
          description: true,
          region: true,
          peopleCount: true,
          photosCount: true,
          audioCount: true,
          storiesCount: true,
          contributorsCount: true,
          updatedAt: true,
        },
      },
    },
  });

  return memberships.map((membership) => ({
    id: membership.family.id,
    slug: membership.family.slug,
    title: membership.family.title,
    surname: membership.family.surname,
    description: membership.family.description,
    region: membership.family.region,
    role: membership.role,
    stats: {
      people: membership.family.peopleCount,
      photos: membership.family.photosCount,
      audio: membership.family.audioCount,
      stories: membership.family.storiesCount,
      contributors: membership.family.contributorsCount,
    },
    updatedAt: membership.family.updatedAt.toISOString(),
  }));
}
