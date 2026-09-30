import { withObservedRoute } from "@/lib/observability";
import { NextResponse } from "next/server";
import { familyWriteErrorResponse } from "@/lib/family-write-error";
import { requireFamilyRole } from "@/lib/auth";
import { uploadMediaAssetForPerson } from "@/lib/family-media-repository";
import { readMediaFormData } from "@/lib/media-request";
import { enforceRateLimit } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-validation";

type RouteContext = {
  params: Promise<{ slug: string; personId: string }>;
};

async function handlePOST(request: Request, context: RouteContext) {
  const { slug, personId } = await context.params;

  try {
    assertSameOrigin(request);
    const access = await requireFamilyRole(slug, ["owner", "admin", "editor"]);

    // Quotas enforce total occupancy; this separate per-user limit caps request frequency.
    await enforceRateLimit({
      key: `media-upload:${access.user.id}`,
      limit: 60,
      windowMs: 60 * 60 * 1000,
      message: "Слишком много загрузок файлов.",
    });

    const { type, file } = await readMediaFormData(request);
    const asset = await uploadMediaAssetForPerson({
      slug, personId, type, file, actorUserId: access.user.id,
      actorName: `${access.user.firstName} ${access.user.lastName}`,
    });

    return NextResponse.json({
      message:
        type === "photo"
          ? "Фотография добавлена в карточку человека."
          : "Голосовой файл добавлен в карточку человека.",
      asset,
    });
  } catch (error) {
    const response = familyWriteErrorResponse(error, {
      fallback: "Не удалось загрузить файл.",
      invalidJson: "Некорректные данные запроса.",
    });
    return NextResponse.json(response.body, { status: response.status });
  }
}

export const POST = withObservedRoute("/api/family/[slug]/people/[personId]/media", handlePOST);
