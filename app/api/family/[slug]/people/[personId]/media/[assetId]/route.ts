import { withObservedRoute } from "@/lib/observability";
import { NextResponse } from "next/server";
import { familyWriteErrorResponse } from "@/lib/family-write-error";
import { requireFamilyRole } from "@/lib/auth";
import {
  deleteMediaAssetFromPerson,
  getMediaAssetForFamily,
} from "@/lib/family-media-repository";
import { buildMediaResponse } from "@/lib/media-response";
import { assertSameOrigin } from "@/lib/request-validation";

type RouteContext = {
  params: Promise<{ slug: string; personId: string; assetId: string }>;
};

async function handleGET(request: Request, context: RouteContext) {
  const { slug, personId, assetId } = await context.params;

  try {
    await requireFamilyRole(slug, ["owner", "admin", "editor", "member", "guest"]);
    const asset = await getMediaAssetForFamily({
      slug,
      personId,
      assetId,
    });
    return await buildMediaResponse(request, asset);
  } catch (error) {
    const response = familyWriteErrorResponse(error, {
      fallback: "Не удалось открыть медиафайл.",
      invalidJson: "Некорректные данные запроса.",
    });
    return NextResponse.json(response.body, { status: response.status });
  }
}

async function handleDELETE(request: Request, context: RouteContext) {
  const { slug, personId, assetId } = await context.params;

  try {
    assertSameOrigin(request);
    const access = await requireFamilyRole(slug, ["owner", "admin", "editor"]);
    const asset = await deleteMediaAssetFromPerson({
      slug,
      personId,
      assetId,
      actorUserId: access.user.id,
      actorName: `${access.user.firstName} ${access.user.lastName}`,
    });

    return NextResponse.json({
      message: asset.cleanupPending
        ? "Медиафайл скрыт из карточки. Очистка хранилища поставлена в очередь."
        : asset.type === "photo"
          ? "Фотография удалена из карточки человека."
          : "Голосовой файл удален из карточки человека.",
    }, { status: asset.cleanupPending ? 202 : 200 });
  } catch (error) {
    const response = familyWriteErrorResponse(error, {
      fallback: "Не удалось удалить медиафайл.",
      invalidJson: "Некорректные данные запроса.",
    });
    return NextResponse.json(response.body, { status: response.status });
  }
}

export const GET = withObservedRoute("/api/family/[slug]/people/[personId]/media/[assetId]", handleGET);
export const DELETE = withObservedRoute("/api/family/[slug]/people/[personId]/media/[assetId]", handleDELETE);
