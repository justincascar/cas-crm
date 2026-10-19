import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { saveClaimDraft } from "@/lib/db/claim-drafts";
import { VersionConflictError } from "@/lib/db/record-version";

export async function POST(request: Request) {
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.json({ error: "Sign in to save a draft." }, { status: 401 });
  if (!isOfficeRole(staff.role)) return NextResponse.json({ error: "Office staff save claim drafts." }, { status: 403 });
  const body = (await request.json()) as { draftId?: string; version?: string; fields?: Record<string, string> };
  const fields = body.fields && typeof body.fields === "object" ? body.fields : {};
  try {
    const saved = saveClaimDraft({
      draftId: body.draftId,
      expectedVersion: body.version,
      payload: fields,
      actorId: staff.id,
    });
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof VersionConflictError) {
      return NextResponse.json(
        {
          error: error.message,
          clash: true,
          version: error.changedAt,
          reloadHref: `/claims/new?draft=${error.recordKey}`,
        },
        { status: 409 },
      );
    }
    const message = error instanceof Error ? error.message : "The draft could not be saved.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
