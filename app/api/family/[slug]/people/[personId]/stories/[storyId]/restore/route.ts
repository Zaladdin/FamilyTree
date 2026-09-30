import { withObservedRoute } from "@/lib/observability";
import { NextResponse } from "next/server";
import { requireFamilyRole } from "@/lib/auth";
import { familyWriteErrorResponse } from "@/lib/family-write-error";
import { restoreStoryForPerson } from "@/lib/family-story-repository";
import { assertSameOrigin, parseStoryVersionInput } from "@/lib/request-validation";

type RouteContext = { params: Promise<{ slug: string; personId: string; storyId: string }> };

async function handlePOST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const { slug, personId, storyId } = await context.params;
    const access = await requireFamilyRole(slug, ["owner", "admin", "editor"]);
    const input = parseStoryVersionInput(await request.json());
    const story = await restoreStoryForPerson({
      slug, personId, storyId, ...input, actorUserId: access.user.id, actorName: `${access.user.firstName} ${access.user.lastName}`,
    });
    return NextResponse.json({ storyId: story.id, personId, version: story.version, message: "История восстановлена." });
  } catch (error) {
    const response = familyWriteErrorResponse(error, {
      fallback: "Не удалось восстановить историю.", invalidJson: "Некорректные данные истории.",
    });
    return NextResponse.json(response.body, { status: response.status });
  }
}

export const POST = withObservedRoute("/api/family/[slug]/people/[personId]/stories/[storyId]/restore", handlePOST);
