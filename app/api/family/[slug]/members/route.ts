import { NextResponse } from "next/server";
import { requireFamilyRole } from "@/lib/auth";
import {
  addFamilyMemberByEmail,
  listFamilyMembers,
  parseAssignableRole,
} from "@/lib/family-members";
import { HttpError } from "@/lib/http-error";
import { assertSameOrigin } from "@/lib/request-validation";
import { FAMILY_ROLE_LABELS } from "@/lib/types";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { slug } = await context.params;

  try {
    const access = await requireFamilyRole(slug, [
      "owner",
      "admin",
      "editor",
      "member",
      "guest",
    ]);
    const members = await listFamilyMembers(slug, access.user.id);

    return NextResponse.json({ members, viewerRole: access.role });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось загрузить список участников.",
      },
      { status },
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { slug } = await context.params;

  try {
    assertSameOrigin(request);
    const access = await requireFamilyRole(slug, ["owner", "admin"]);
    const payload = (await request.json()) as Record<string, unknown>;

    if (typeof payload?.email !== "string") {
      throw new HttpError(400, "Укажите email участника.");
    }

    const role = parseAssignableRole(payload.role);
    const member = await addFamilyMemberByEmail({
      slug,
      email: payload.email,
      role,
      actor: {
        userId: access.user.id,
        role: access.role,
        name: `${access.user.firstName} ${access.user.lastName}`,
      },
    });

    return NextResponse.json({
      message: `${member.name} добавлен(а) в семью с ролью "${FAMILY_ROLE_LABELS[member.role]}".`,
      member,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось добавить участника.",
      },
      { status },
    );
  }
}
