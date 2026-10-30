import { NextResponse } from "next/server";
import { getRequestStaff } from "@/lib/auth/session";
import { recordBreach, updateBreach } from "@/lib/db/breaches";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const form = await request.formData();
  const text = (name: string) => String(form.get(name) || "");
  const back = new URL("/settings/breaches", origin);
  try {
    if (text("intent") === "record") {
      recordBreach({ actorId: staff.id, discoveredAt: text("discoveredAt"), whatHappened: text("whatHappened"), whoseData: text("whoseData"), actions: text("actions") });
    } else if (text("intent") === "update") {
      updateBreach({ actorId: staff.id, breachId: text("breachId"), decision: text("decision"), reason: text("reason"), actions: text("actions") });
    } else {
      throw new Error("Nothing was changed.");
    }
    back.searchParams.set("saved", "1");
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "Nothing was changed.");
  }
  return NextResponse.redirect(back, 303);
}
