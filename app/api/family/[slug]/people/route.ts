import { withObservedRoute } from "@/lib/observability";
import { NextResponse } from "next/server";
import { requireFamilyRole } from "@/lib/auth";
import { familyWriteErrorResponse } from "@/lib/family-write-error";
import { createPersonInFamily } from "@/lib/family-repository";
import { assertSameOrigin, parseAddPersonInput } from "@/lib/request-validation";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

async function handlePOST(request: Request, context: RouteContext) {
  const { slug } = await context.params;

  try {
    assertSameOrigin(request);
    const access = await requireFamilyRole(slug, ["owner", "admin", "editor"]);
    const payload = parseAddPersonInput(await request.json());
    const person = await createPersonInFamily(
      slug,
      payload,
      `${access.user.firstName} ${access.user.lastName}`,
      access.user.id,
    );

    return NextResponse.json({
      message: `${person.firstName} ${person.lastName} добавлен(а) в дерево.`,
      personId: person.id,
      warnings: person.warnings,
    });
  } catch (error) {
    const { status, body } = familyWriteErrorResponse(error, {
      fallback: "Не удалось сохранить человека в базу.",
      invalidJson: "Некорректные данные человека.",
    });
    return NextResponse.json(body, { status });
  }
}

export const POST = withObservedRoute("/api/family/[slug]/people", handlePOST);
