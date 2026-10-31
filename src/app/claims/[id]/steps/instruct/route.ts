import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { sendEngineerInstruction, sendToAudatexEstimator } from "@/lib/db/engineer-dispatch";
import { browserOrigin } from "@/lib/http/browser-origin";

/** R65: step 5 in one click: the engineer instruction, the Audatex hand-off, or both. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const form = await request.formData();
  const back = new URL(`/claims/${id}`, origin);
  back.hash = "step-engineer";
  try {
    const intent = String(form.get("intent") || "");
    const said: string[] = [];
    if (intent === "engineer" || intent === "both") {
      const sent = await sendEngineerInstruction({
        claimId: id,
        actorId: staff.id,
        engineerId: String(form.get("engineerId") || ""),
        sendWithoutPhotos: form.get("sendWithoutPhotos") === "yes",
      });
      said.push(`Instruction sent to ${sent.engineerName}${sent.cc.length ? `, copied to ${sent.cc.join(", ")}` : ""}${sent.simulated ? " (simulated: the mailbox is not connected)" : ""}.`);
    }
    if (intent === "audatex" || intent === "both") {
      const handed = await sendToAudatexEstimator({ claimId: id, actorId: staff.id });
      said.push(`Sent to ${handed.estimatorName} for the Audatex estimate: "${handed.title}" is on their task list, due today.`);
    }
    if (!said.length) throw new Error("Nothing was sent.");
    back.searchParams.set("stepDone", said.join(" ").slice(0, 600));
  } catch (error) {
    back.searchParams.set("stepError", (error instanceof Error ? error.message : "Nothing was sent.").slice(0, 500));
  }
  return NextResponse.redirect(back, 303);
}
