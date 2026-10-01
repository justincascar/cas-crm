import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { sendPreparedCorrespondence } from "@/lib/db/mailbox-send";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const fallback = new URL(`/claims/${id}`, origin);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(fallback, 303);
  const form = await request.formData();
  const returnTo = String(form.get("returnTo") || "");
  const safeReturn = returnTo.startsWith(`/claims/${id}`) ? returnTo : `/claims/${id}`;
  const back = (name: "mailboxError" | "mailboxSent", value: string) => {
    const url = new URL(safeReturn, origin);
    url.searchParams.set(name, value);
    return NextResponse.redirect(url, 303);
  };
  const correspondenceId = String(form.get("correspondenceId") || "");
  try {
    await sendPreparedCorrespondence({ claimId: id, correspondenceId, actorId: staff.id });
    return back("mailboxSent", correspondenceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Microsoft 365 did not send this email. Nothing was sent.";
    return back("mailboxError", message);
  }
}
