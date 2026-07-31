import { NextResponse } from "next/server";
import { requireFamilyRole } from "@/lib/auth";
import { HttpError } from "@/lib/http-error";
import { createStoryForPerson } from "@/lib/family-repository";
import { assertSameOrigin, parseCreateStoryInput } from "@/lib/request-validation";

type RouteContext = {
  params: Promise<{ slug: string; personId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
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
    });

    return NextResponse.json({
      message: `История "${story.title}" добавлена.`,
      storyId: story.id,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось сохранить историю.",
      },
      { status },
    );
  }
}
