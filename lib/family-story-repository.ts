import type { Prisma, Story as StoredStory } from "@prisma/client";
import { HttpError } from "@/lib/http-error";
import { parseCreateStoryInput, parseStoryVersionInput, parseUpdateStoryInput } from "@/lib/request-validation";
import { withSerializableTransaction } from "@/lib/serializable-transaction";

type StoryActor = { slug: string; personId: string; actorName: string; actorUserId: string };
type StoryContent = { title: string; body: string; narrator?: string };
type StoryMutation = StoryActor & { storyId: string; expectedVersion: number };
type StoryAction = "story_added" | "story_updated" | "story_deleted" | "story_restored";

async function loadContext(transaction: Prisma.TransactionClient, params: StoryActor) {
  const family = await transaction.family.findUnique({ where: { slug: params.slug }, select: { id: true } });
  if (!family) throw new HttpError(404, "Семья не найдена.");
  if (!params.actorUserId) throw new HttpError(403, "Недостаточно прав для этого действия.");
  const membership = await transaction.familyMembership.findFirst({
    where: { familyId: family.id, userId: params.actorUserId }, select: { role: true },
  });
  if (!membership || !["owner", "admin", "editor"].includes(membership.role)) {
    throw new HttpError(403, "Недостаточно прав для этого действия.");
  }
  const person = await transaction.person.findFirst({
    where: { id: params.personId, familyId: family.id, isArchived: false },
    select: { id: true, firstName: true, middleName: true, lastName: true },
  });
  if (!person) throw new HttpError(404, "Человек не найден в активном дереве.");
  return { familyId: family.id, personName: [person.firstName, person.middleName, person.lastName].filter(Boolean).join(" ") };
}

function serialize(story: StoredStory) {
  return {
    id: story.id, title: story.title, body: story.body, narrator: story.narrator ?? undefined,
    createdAt: story.createdAt.toISOString(), version: story.version,
    deletedAt: story.deletedAt?.toISOString(),
  };
}

async function updateCountAndAudit(
  transaction: Prisma.TransactionClient,
  params: StoryActor,
  context: { familyId: string; personName: string },
  story: StoredStory,
  action: StoryAction,
) {
  const storiesCount = await transaction.story.count({ where: {
    deletedAt: null, person: { familyId: context.familyId, isArchived: false },
  } });
  await transaction.family.update({ where: { id: context.familyId }, data: { storiesCount } });
  const verb = { story_added: "добавил(а)", story_updated: "обновил(а)", story_deleted: "удалил(а)", story_restored: "восстановил(а)" }[action];
  await transaction.auditLog.create({ data: {
    familyId: context.familyId, action, actorName: params.actorName, personId: params.personId, personName: context.personName,
    message: `${params.actorName} ${verb} историю «${story.title}» в карточке «${context.personName}». Версия: ${story.version}.`,
  } });
}

export async function createStoryForPerson(params: StoryActor & StoryContent) {
  const content = parseCreateStoryInput(params);
  return withSerializableTransaction(async (transaction) => {
    const context = await loadContext(transaction, params);
    const story = await transaction.story.create({ data: {
      personId: params.personId, title: content.title, body: content.body, narrator: content.narrator || null,
    } });
    await updateCountAndAudit(transaction, params, context, story, "story_added");
    return serialize(story);
  });
}

function conflict() {
  return new HttpError(409, "История уже изменена. Черновик сохранён. Скопируйте нужный текст, закройте форму и откройте историю заново.");
}

async function mutateStory(
  params: StoryMutation,
  action: Exclude<StoryAction, "story_added">,
  content?: ReturnType<typeof parseCreateStoryInput>,
) {
  const { expectedVersion } = parseStoryVersionInput(params);
  return withSerializableTransaction(async (transaction) => {
    const context = await loadContext(transaction, params);
    const current = await transaction.story.findFirst({ where: { id: params.storyId, personId: params.personId } });
    if (!current) throw new HttpError(404, "История не найдена.");
    if (current.version !== expectedVersion) throw conflict();
    const restore = action === "story_restored";
    if (restore ? current.deletedAt === null : current.deletedAt !== null) {
      throw new HttpError(409, restore ? "История уже восстановлена." : "История удалена. Сначала восстановите её.");
    }
    const now = new Date();
    const data = {
      ...(content ? { title: content.title, body: content.body, narrator: content.narrator || null } : {}),
      ...(action === "story_deleted" ? { deletedAt: now } : restore ? { deletedAt: null } : {}),
      version: { increment: 1 }, updatedAt: now,
    };
    const updated = await transaction.story.updateMany({
      where: { id: current.id, personId: params.personId, version: expectedVersion, deletedAt: restore ? { not: null } : null },
      data,
    });
    if (updated.count !== 1) throw conflict();
    const story: StoredStory = { ...current, ...data, version: current.version + 1 };
    await updateCountAndAudit(transaction, params, context, story, action);
    return serialize(story);
  });
}

export async function updateStoryForPerson(params: StoryMutation & StoryContent) {
  const content = parseUpdateStoryInput(params);
  return mutateStory(params, "story_updated", content);
}

export async function deleteStoryForPerson(params: StoryMutation) {
  return mutateStory(params, "story_deleted");
}

export async function restoreStoryForPerson(params: StoryMutation) {
  return mutateStory(params, "story_restored");
}
