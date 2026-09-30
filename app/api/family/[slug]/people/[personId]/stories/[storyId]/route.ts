import { withObservedRoute } from "@/lib/observability";
import { NextResponse } from "next/server";
import { requireFamilyRole } from "@/lib/auth";
import { familyWriteErrorResponse } from "@/lib/family-write-error";
import { deleteStoryForPerson, updateStoryForPerson } from "@/lib/family-story-repository";
import { assertSameOrigin, parseStoryVersionInput, parseUpdateStoryInput } from "@/lib/request-validation";

type RouteContext = { params: Promise<{ slug: string; personId: string; storyId: string }> };

async function mutate(request: Request, context: RouteContext, remove: boolean) {
  try {
    assertSameOrigin(request);
    const { slug, personId, storyId } = await context.params;
    const access = await requireFamilyRole(slug, ["owner", "admin", "editor"]);
    const payload: unknown = await request.json();
    const params = { slug, personId, storyId, actorUserId: access.user.id, actorName: `${access.user.firstName} ${access.user.lastName}` };
    const story = remove
      ? await deleteStoryForPerson({ ...params, ...parseStoryVersionInput(payload) })
      : await updateStoryForPerson({ ...params, ...parseUpdateStoryInput(payload) });
    return NextResponse.json({ storyId: story.id, personId, version: story.version, message: remove ? "История удалена." : "История изменена." });
  } catch (error) {
    const response = familyWriteErrorResponse(error, {
      fallback: remove ? "Не удалось удалить историю." : "Не удалось изменить историю.",
      invalidJson: "Некорректные данные истории.",
    });
    return NextResponse.json(response.body, { status: response.status });
  }
}

const handlePATCH = (request: Request, context: RouteContext) => mutate(request, context, false);
const handleDELETE = (request: Request, context: RouteContext) => mutate(request, context, true);

export const PATCH = withObservedRoute("/api/family/[slug]/people/[personId]/stories/[storyId]", handlePATCH);
export const DELETE = withObservedRoute("/api/family/[slug]/people/[personId]/stories/[storyId]", handleDELETE);
