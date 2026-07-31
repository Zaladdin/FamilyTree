import { NextResponse } from "next/server";
import { requireFamilyRole } from "@/lib/auth";
import { HttpError } from "@/lib/http-error";
import { archivePersonInFamily } from "@/lib/family-repository";
import { assertSameOrigin } from "@/lib/request-validation";

type RouteContext = {
  params: Promise<{ slug: string; personId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { slug, personId } = await context.params;

  try {
    assertSameOrigin(request);
    const access = await requireFamilyRole(slug, ["owner", "admin", "editor"]);
    await archivePersonInFamily({
      slug,
      personId,
      actorName: `${access.user.firstName} ${access.user.lastName}`,
    });

    return NextResponse.json({
      message: "Человек перенесен в архив и скрыт из активного дерева.",
      personId,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось архивировать человека.",
      },
      { status },
    );
  }
}
