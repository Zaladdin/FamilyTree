import { withObservedRoute } from "@/lib/observability";
import { NextResponse } from "next/server";
import { requireFamilyRole } from "@/lib/auth";
import { getFamilyInvitations } from "@/lib/family-invitations";
import { familyWriteErrorResponse } from "@/lib/family-write-error";

async function handleGET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  try {
    const access = await requireFamilyRole(slug, ["owner", "admin"]);
    return NextResponse.json({ invitations: await getFamilyInvitations(slug, access.user.id) });
  } catch (error) {
    const result = familyWriteErrorResponse(error, { fallback: "Не удалось загрузить приглашения.", invalidJson: "Некорректные данные запроса." });
    return NextResponse.json(result.body, { status: result.status });
  }
}

export const GET = withObservedRoute("/api/family/[slug]/invitations", handleGET);
