import { withObservedRoute } from "@/lib/observability";
import { NextResponse } from "next/server";
import { familyWriteErrorResponse } from "@/lib/family-write-error";
import { requireUser } from "@/lib/auth";
import { createFamilySpace } from "@/lib/family-admin-repository";
import { parseCreateFamilyInput } from "@/lib/family-management";
import { assertSameOrigin } from "@/lib/request-validation";

async function handlePOST(request: Request) {
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
    const response = familyWriteErrorResponse(error, {
      fallback: "Не удалось создать семейное пространство.",
      invalidJson: "Некорректные данные запроса.",
    });
    return NextResponse.json(response.body, { status: response.status });
  }
}

export const POST = withObservedRoute("/api/families", handlePOST);
