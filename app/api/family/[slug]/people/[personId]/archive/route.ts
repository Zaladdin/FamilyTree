import { withObservedRoute } from "@/lib/observability";
import { NextResponse } from "next/server";
import { familyWriteErrorResponse } from "@/lib/family-write-error";
import { requireFamilyRole } from "@/lib/auth";
import { archivePersonInFamily } from "@/lib/family-repository";
import { assertSameOrigin } from "@/lib/request-validation";

type RouteContext = {
  params: Promise<{ slug: string; personId: string }>;
};

async function handlePOST(request: Request, context: RouteContext) {
  const { slug, personId } = await context.params;

  try {
    assertSameOrigin(request);
    const access = await requireFamilyRole(slug, ["owner", "admin", "editor"]);
    await archivePersonInFamily({
      slug,
      personId,
      actorUserId: access.user.id,
      actorName: `${access.user.firstName} ${access.user.lastName}`,
    });

    return NextResponse.json({
      message: "Человек перенесен в архив и скрыт из активного дерева.",
      personId,
    });
  } catch (error) {
    const response = familyWriteErrorResponse(error, {
      fallback: "Не удалось архивировать человека.",
      invalidJson: "Некорректные данные запроса.",
    });
    return NextResponse.json(response.body, { status: response.status });
  }
}

export const POST = withObservedRoute("/api/family/[slug]/people/[personId]/archive", handlePOST);
