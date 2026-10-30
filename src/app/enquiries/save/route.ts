import { NextResponse } from "next/server";
import { getRequestStaff } from "@/lib/auth/session";
import { closeEnquiry, reopenEnquiry, startClaimFromEnquiry } from "@/lib/db/website-enquiries";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const form = await request.formData();
  const text = (name: string) => String(form.get(name) || "");
  const back = new URL("/enquiries", origin);
  const who = { enquiryId: text("enquiryId"), actorId: staff.id, actorRole: staff.role };
  try {
    if (text("intent") === "convert") {
      // The new-claim form opens filled from the enquiry. Nothing is a claim until staff check it and save it.
      const draftId = startClaimFromEnquiry(who);
      return NextResponse.redirect(new URL(`/claims/new?draft=${encodeURIComponent(draftId)}`, origin), 303);
    }
    if (text("intent") === "close") closeEnquiry({ ...who, reason: text("reason") });
    else if (text("intent") === "reopen") reopenEnquiry(who);
    else throw new Error("Nothing was changed.");
    back.searchParams.set("saved", "1");
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "Nothing was changed.");
  }
  return NextResponse.redirect(back, 303);
}
