import { withObservedRoute } from "@/lib/observability";
import { NextResponse } from "next/server";
import { familyWriteErrorResponse } from "@/lib/family-write-error";
import { requireFamilyRole } from "@/lib/auth";
import { updatePersonInFamily } from "@/lib/family-repository";
import { assertSameOrigin, parseUpdatePersonInput } from "@/lib/request-validation";

type RouteContext = {
  params: Promise<{ slug: string; personId: string }>;
};

async function handlePATCH(request: Request, context: RouteContext) {
  const { slug, personId } = await context.params;

  try {
    assertSameOrigin(request);
    const access = await requireFamilyRole(slug, ["owner", "admin", "editor"]);
    const payload = parseUpdatePersonInput(await request.json());
    const person = await updatePersonInFamily(
      slug,
      personId,
      payload,
      `${access.user.firstName} ${access.user.lastName}`,
      access.user.id,
    );

    return NextResponse.json({
      message: `${person.firstName} ${person.lastName} обновлен(а).`,
      personId: person.id,
      version: person.version,
    });
  } catch (error) {
    const response = familyWriteErrorResponse(error, {
      fallback: "Не удалось обновить карточку человека.",
      invalidJson: "Некорректные данные запроса.",
    });
    return NextResponse.json(response.body, { status: response.status });
  }
}

export const PATCH = withObservedRoute("/api/family/[slug]/people/[personId]", handlePATCH);
