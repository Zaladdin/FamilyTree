import { NextResponse } from "next/server";
import { requireFamilyRole } from "@/lib/auth";
import { HttpError } from "@/lib/http-error";
import {
  deleteMediaAssetFromPerson,
  getMediaAssetForFamily,
} from "@/lib/family-repository";
import { readUploadByStoragePath } from "@/lib/media-storage";
import { assertSameOrigin } from "@/lib/request-validation";

type RouteContext = {
  params: Promise<{ slug: string; personId: string; assetId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { slug, personId, assetId } = await context.params;

  try {
    await requireFamilyRole(slug, ["owner", "admin", "editor", "member", "guest"]);
    const asset = await getMediaAssetForFamily({
      slug,
      personId,
      assetId,
    });
    const fileBuffer = await readUploadByStoragePath(asset.storagePath);

    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Length": String(asset.size),
        "Content-Disposition": `inline; filename="${encodeURIComponent(asset.title)}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 404;

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось открыть медиафайл.",
      },
      { status },
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { slug, personId, assetId } = await context.params;

  try {
    assertSameOrigin(request);
    const access = await requireFamilyRole(slug, ["owner", "admin", "editor"]);
    const asset = await deleteMediaAssetFromPerson({
      slug,
      personId,
      assetId,
      actorName: `${access.user.firstName} ${access.user.lastName}`,
    });

    return NextResponse.json({
      message:
        asset.type === "photo"
          ? "Фотография удалена из карточки человека."
          : "Голосовой файл удален из карточки человека.",
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось удалить медиафайл.",
      },
      { status },
    );
  }
}
