import { NextResponse } from "next/server";
import { requireFamilyRole } from "@/lib/auth";
import { HttpError } from "@/lib/http-error";
import { createMediaAssetForPerson } from "@/lib/family-repository";
import { deleteUploadByStoragePath, saveUpload } from "@/lib/media-storage";
import { MediaAssetType } from "@/lib/types";

type RouteContext = {
  params: Promise<{ slug: string; personId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { slug, personId } = await context.params;

  try {
    const access = await requireFamilyRole(slug, ["owner", "admin", "editor"]);
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
