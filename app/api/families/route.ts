import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createFamilySpace } from "@/lib/family-admin-repository";
import { parseCreateFamilyInput } from "@/lib/family-management";
import { HttpError } from "@/lib/http-error";
import { assertSameOrigin } from "@/lib/request-validation";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const payload = parseCreateFamilyInput(await request.json());
    const family = await createFamilySpace({ input: payload, user });

    return NextResponse.json({
      slug: family.slug,
      message: "Семья создана.",
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось создать семейное пространство.",
      },
      { status },
    );
  }
}
