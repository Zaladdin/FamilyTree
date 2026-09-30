import { withObservedRoute } from "@/lib/observability";
import { NextResponse } from "next/server";
import { requireFamilyRole } from "@/lib/auth";
import { createRelationshipInFamily } from "@/lib/family-relationship-repository";
import { parseAddExistingRelationshipInput } from "@/lib/family-relationships";
import { familyWriteErrorResponse } from "@/lib/family-write-error";
import { assertSameOrigin } from "@/lib/request-validation";

type RouteContext = {
  params: Promise<{ slug: string; personId: string }>;
};

async function handlePOST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const { slug, personId } = await context.params;
    const access = await requireFamilyRole(slug, ["owner", "admin", "editor"]);
    const input = parseAddExistingRelationshipInput(await request.json());
    const result = await createRelationshipInFamily(slug, personId, input, `${access.user.firstName} ${access.user.lastName}`, access.user.id);
    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = familyWriteErrorResponse(error, {
      fallback: "Не удалось сохранить родственную связь.",
      invalidJson: "Некорректные данные родственной связи.",
    });
    return NextResponse.json(body, { status });
  }
}

export const POST = withObservedRoute("/api/family/[slug]/people/[personId]/relationships", handlePOST);
