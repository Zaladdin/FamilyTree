import { withObservedRoute } from "@/lib/observability";
import { NextResponse } from "next/server";
import { requireFamilyRole } from "@/lib/auth";
import { deleteRelationshipInFamily, parseRelationshipVersionInput, updateRelationshipInFamily } from "@/lib/family-relationship-repository";
import { parseAddExistingRelationshipInput } from "@/lib/family-relationships";
import { familyWriteErrorResponse } from "@/lib/family-write-error";
import { assertSameOrigin } from "@/lib/request-validation";

type RouteContext = { params: Promise<{ slug: string; personId: string; relationshipId: string }> };

async function mutate(request: Request, context: RouteContext, action: "update" | "delete") {
  try {
    assertSameOrigin(request);
    const { slug, personId, relationshipId } = await context.params;
    const access = await requireFamilyRole(slug, ["owner", "admin", "editor"]);
    const payload: unknown = await request.json();
    const version = parseRelationshipVersionInput(payload);
    const actorName = `${access.user.firstName} ${access.user.lastName}`;
    const result = action === "update"
      ? await updateRelationshipInFamily(slug, personId, relationshipId, { ...parseAddExistingRelationshipInput(payload), ...version }, actorName, access.user.id)
      : await deleteRelationshipInFamily(slug, personId, relationshipId, version, actorName, access.user.id);
    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = familyWriteErrorResponse(error, {
      fallback: action === "update" ? "Не удалось изменить родственную связь." : "Не удалось удалить родственную связь.",
      invalidJson: "Некорректные данные родственной связи.",
    });
    return NextResponse.json(body, { status });
  }
}

const handlePATCH = (request: Request, context: RouteContext) => mutate(request, context, "update");
const handleDELETE = (request: Request, context: RouteContext) => mutate(request, context, "delete");

export const PATCH = withObservedRoute("/api/family/[slug]/people/[personId]/relationships/[relationshipId]", handlePATCH);
export const DELETE = withObservedRoute("/api/family/[slug]/people/[personId]/relationships/[relationshipId]", handleDELETE);
