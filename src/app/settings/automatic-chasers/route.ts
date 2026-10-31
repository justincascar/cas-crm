import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { canApproveChasers, runAutomaticChasers, setChaseRuleApproval } from "@/lib/db/auto-chasers";
import { browserOrigin } from "@/lib/http/browser-origin";

/** R30: Justin's switch for each chaser rule, and a pass of the automatic chaser now (it also runs on its own). */
export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const back = new URL("/settings", origin);
  back.hash = "automatic-chasers";
  const form = await request.formData();
  try {
    const intent = String(form.get("intent") || "");
    if (intent === "approve" || intent === "withdraw") {
      setChaseRuleApproval({ kind: String(form.get("kind") || ""), approved: intent === "approve", actorId: staff.id });
      back.searchParams.set("saved", "automatic-chasers");
    } else if (intent === "run") {
      if (!canApproveChasers(staff.id)) throw new Error("Only Justin can run the automatic chaser by hand. It runs on its own every five minutes.");
      const result = await runAutomaticChasers();
      back.searchParams.set("saved", "automatic-chasers");
      back.searchParams.set("chaserRun", result.outcome.slice(0, 300));
    } else {
      throw new Error("Nothing was changed.");
    }
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "That could not be saved.");
  }
  return NextResponse.redirect(back, 303);
}
