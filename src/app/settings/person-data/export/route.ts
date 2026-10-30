import { NextResponse } from "next/server";
import { getRequestStaff } from "@/lib/auth/session";
import { canUsePersonData, exportPersonData } from "@/lib/db/person-data";
import { browserOrigin } from "@/lib/http/browser-origin";

/** Everything held about one person, as a zip, for a subject access request. Justin only; logged. */
export async function GET(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!canUsePersonData(staff.id)) return new NextResponse("Only Justin can export a person's data.", { status: 403 });
  const personId = new URL(request.url).searchParams.get("person") || "";
  try {
    const { zip, filename } = exportPersonData({ actorId: staff.id, personId });
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return new NextResponse(error instanceof Error ? error.message : "Not exported.", { status: 404 });
  }
}
