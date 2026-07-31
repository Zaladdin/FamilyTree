import { NextResponse } from "next/server";
import { requireFamilyRole } from "@/lib/auth";
import { HttpError } from "@/lib/http-error";
import { updatePersonInFamily } from "@/lib/family-repository";
import { assertSameOrigin, parseUpdatePersonInput } from "@/lib/request-validation";

type RouteContext = {
  params: Promise<{ slug: string; personId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { slug, personId } = await context.params;

  try {
    assertSameOrigin(request);
    const access = await requireFamilyRole(slug, ["owner", "admin", "editor"]);
    const payload = parseUpdatePersonInput(await request.json());
    const person = await updatePersonInFamily(
      slug,
      personId,
      payload,
      `${access.user.firstName} ${access.user.lastName}`,
    );

    return NextResponse.json({
      message: `${person.firstName} ${person.lastName} обновлен(а).`,
      personId: person.id,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось обновить карточку человека.",
      },
      { status },
    );
  }
}
