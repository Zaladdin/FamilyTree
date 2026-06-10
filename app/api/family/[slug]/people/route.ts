import { NextResponse } from "next/server";
import { requireFamilyRole } from "@/lib/auth";
import { HttpError } from "@/lib/http-error";
import { createPersonInFamily } from "@/lib/family-repository";
import { parseAddPersonInput } from "@/lib/request-validation";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { slug } = await context.params;

  try {
    const access = await requireFamilyRole(slug, ["owner", "admin", "editor"]);
    const payload = parseAddPersonInput(await request.json());
    const person = await createPersonInFamily(
      slug,
      payload,
      `${access.user.firstName} ${access.user.lastName}`,
    );

    return NextResponse.json({
      message: `${person.firstName} ${person.lastName} добавлен(а) в дерево.`,
      personId: person.id,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось сохранить человека в базу.",
      },
      { status },
    );
  }
}
