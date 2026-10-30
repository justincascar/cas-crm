import { NextResponse } from "next/server";
import { getRequestStaff } from "@/lib/auth/session";
import { erasePerson, restrictPerson } from "@/lib/db/person-data";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const form = await request.formData();
  const back = new URL("/settings/person-data", origin);
  const q = String(form.get("q") || "");
  if (q) back.searchParams.set("q", q);
  try {
    const personId = String(form.get("personId") || "");
    const reason = String(form.get("reason") || "");
    const intent = String(form.get("intent") || "");
    if (intent === "restrict") restrictPerson({ actorId: staff.id, personId, reason });
    else if (intent === "unrestrict") restrictPerson({ actorId: staff.id, personId, reason: "", lift: true });
    else if (intent === "erase") erasePerson({ actorId: staff.id, personId, reason });
    else throw new Error("Nothing was changed.");
    back.searchParams.set("saved", "1");
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "Nothing was changed.");
  }
  return NextResponse.redirect(back, 303);
}
