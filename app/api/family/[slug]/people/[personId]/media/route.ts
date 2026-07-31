import { NextResponse } from "next/server";
import { requireFamilyRole } from "@/lib/auth";
import { HttpError } from "@/lib/http-error";
import { createMediaAssetForPerson } from "@/lib/family-repository";
import { deleteUploadByStoragePath, saveUpload } from "@/lib/media-storage";
import { enforceRateLimit } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-validation";
import { MediaAssetType } from "@/lib/types";

type RouteContext = {
  params: Promise<{ slug: string; personId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { slug, personId } = await context.params;

  try {
    assertSameOrigin(request);
    const access = await requireFamilyRole(slug, ["owner", "admin", "editor"]);

    // Disk-fill backstop: uploads are authenticated, so key the limit by user.
    // 60/hour is far above normal use but caps abuse at ~1.2 GB/hour.
    await enforceRateLimit({
      key: `media-upload:${access.user.id}`,
      limit: 60,
      windowMs: 60 * 60 * 1000,
      message: "Слишком много загрузок файлов.",
    });

    // Reject oversized request bodies before buffering the multipart payload.
    // 20 MB is the largest allowed asset (audio); add headroom for multipart overhead.
    const MAX_REQUEST_BYTES = 21 * 1024 * 1024;
    const contentLength = Number(request.headers.get("content-length") ?? "0");

    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      throw new HttpError(413, "Файл слишком большой.");
    }

    const formData = await request.formData();
    const typeValue = formData.get("type");
    const fileValue = formData.get("file");

    if (typeValue !== "photo" && typeValue !== "audio") {
      throw new Error("Нужно указать тип файла: photo или audio.");
    }

    if (!(fileValue instanceof File)) {
      throw new Error("Файл не был передан.");
    }

    const type = typeValue as MediaAssetType;
    const storedFile = await saveUpload({
      familySlug: slug,
      personId,
      type,
      file: fileValue,
    });

    let asset;
    try {
      asset = await createMediaAssetForPerson({
        slug,
        personId,
        type,
        title: storedFile.title,
        storagePath: storedFile.storagePath,
        mimeType: storedFile.mimeType,
        size: storedFile.size,
        actorName: `${access.user.firstName} ${access.user.lastName}`,
      });
    } catch (error) {
      await deleteUploadByStoragePath(storedFile.storagePath).catch(() => undefined);
      throw error;
    }

    return NextResponse.json({
      message:
        type === "photo"
          ? "Фотография добавлена в карточку человека."
          : "Голосовой файл добавлен в карточку человека.",
      asset,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось загрузить файл.",
      },
      { status },
    );
  }
}
