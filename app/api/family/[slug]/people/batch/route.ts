import { withObservedRoute } from "@/lib/observability";
import { NextResponse } from "next/server";
import { requireFamilyRole } from "@/lib/auth";
import { parseBatchPersonInput } from "@/lib/family-batch";
import { createPeopleInFamily } from "@/lib/family-repository";
import { familyWriteErrorResponse } from "@/lib/family-write-error";
import { assertSameOrigin } from "@/lib/request-validation";

type RouteContext = { params: Promise<{ slug: string }> };

async function handlePOST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const { slug } = await context.params;
    const access = await requireFamilyRole(slug, ["owner", "admin", "editor"]);
    const entries = parseBatchPersonInput(await request.json());
    const { people, warnings } = await createPeopleInFamily(slug, entries, `${access.user.firstName} ${access.user.lastName}`, access.user.id);
    return NextResponse.json({
      personId: people[0].id,
      personIds: people.map((person) => person.id),
      message: `Добавлено в дерево: ${people.length}.`,
      warnings,
    });
  } catch (error) {
    const { status, body } = familyWriteErrorResponse(error, {
      fallback: "Не удалось сохранить людей. Попробуйте ещё раз.",
      invalidJson: "Некорректные данные списка людей.",
    });
    return NextResponse.json(body, { status });
  }
}

export const POST = withObservedRoute("/api/family/[slug]/people/batch", handlePOST);
