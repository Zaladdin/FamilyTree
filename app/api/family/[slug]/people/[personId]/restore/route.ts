import { NextResponse } from "next/server";
import { requireFamilyRole } from "@/lib/auth";
import { HttpError } from "@/lib/http-error";
import { restorePersonInFamily } from "@/lib/family-repository";

type RouteParams = {
  params: Promise<{
    slug: string;
    personId: string;
  }>;
};

export async function POST(_: Request, { params }: RouteParams) {
  try {
    const { slug, personId } = await params;
    const access = await requireFamilyRole(slug, ["owner", "admin", "editor"]);
    await restorePersonInFamily({
      slug,
      personId,
      actorName: `${access.user.firstName} ${access.user.lastName}`,
    });

    return NextResponse.json({
      message: "Человек восстановлен в активное дерево.",
      personId,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось восстановить человека из архива.",
      },
      { status },
    );
  }
}
