import { withObservedRoute } from "@/lib/observability";
import { NextResponse } from "next/server";
import { familyWriteErrorResponse } from "@/lib/family-write-error";
import { requireFamilyRole } from "@/lib/auth";
import { createStoryForPerson } from "@/lib/family-story-repository";
import { assertSameOrigin, parseCreateStoryInput } from "@/lib/request-validation";

type RouteContext = {
  params: Promise<{ slug: string; personId: string }>;
};

async function handlePOST(request: Request, context: RouteContext) {
  const { slug, personId } = await context.params;

  try {
    assertSameOrigin(request);
    const access = await requireFamilyRole(slug, ["owner", "admin", "editor"]);
    const payload = parseCreateStoryInput(await request.json());
    const story = await createStoryForPerson({
      slug,
      personId,
      title: payload.title,
      body: payload.body,
      narrator: payload.narrator,
      actorName: `${access.user.firstName} ${access.user.lastName}`,
      actorUserId: access.user.id,
    });

    return NextResponse.json({
      message: `История "${story.title}" добавлена.`,
      storyId: story.id,
      personId,
      version: story.version,
    });
  } catch (error) {
    const response = familyWriteErrorResponse(error, {
      fallback: "Не удалось сохранить историю.",
      invalidJson: "Некорректные данные запроса.",
    });
    return NextResponse.json(response.body, { status: response.status });
  }
}

export const POST = withObservedRoute("/api/family/[slug]/people/[personId]/stories", handlePOST);
