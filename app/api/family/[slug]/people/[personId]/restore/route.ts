import { withObservedRoute } from "@/lib/observability";
import { NextResponse } from "next/server";
import { familyWriteErrorResponse } from "@/lib/family-write-error";
import { requireFamilyRole } from "@/lib/auth";
import { restorePersonInFamily } from "@/lib/family-repository";
import { assertSameOrigin } from "@/lib/request-validation";

type RouteParams = {
  params: Promise<{
    slug: string;
    personId: string;
  }>;
};

async function handlePOST(request: Request, { params }: RouteParams) {
  try {
    assertSameOrigin(request);
    const { slug, personId } = await params;
    const access = await requireFamilyRole(slug, ["owner", "admin", "editor"]);
    await restorePersonInFamily({
      slug,
      personId,
      actorUserId: access.user.id,
      actorName: `${access.user.firstName} ${access.user.lastName}`,
    });

    return NextResponse.json({
      message: "Человек восстановлен в активное дерево.",
      personId,
    });
  } catch (error) {
    const response = familyWriteErrorResponse(error, {
      fallback: "Не удалось восстановить человека из архива.",
      invalidJson: "Некорректные данные запроса.",
    });
    return NextResponse.json(response.body, { status: response.status });
  }
}

export const POST = withObservedRoute("/api/family/[slug]/people/[personId]/restore", handlePOST);
