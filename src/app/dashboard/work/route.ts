import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { logDeskCall, prepareDeskChaser, setWorkWait, undoWorkWait } from "@/lib/db/desk-work";
import { isCallOutcome, isDeskIntent } from "@/lib/domain/desk-actions";
import { browserOrigin } from "@/lib/http/browser-origin";
import { VersionConflictError, pathWithClash } from "@/lib/db/record-version";
import { formSubmitKey } from "@/lib/db/submit-key";

/** Log a call, wait, undo a wait, or prepare a chaser. Nothing here approves a settlement or changes bank details. */
export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const back = (query: string) => NextResponse.redirect(new URL(`/${query}`, origin), 303);
  if (!isDeskIntent(intent)) return back("?workError=That action is not available from the desk.");
  try {
    if (intent === "undo") {
      undoWorkWait({ waitId: String(form.get("waitId") || ""), actorId: staff.id });
      return back("");
    }
    const claimId = String(form.get("claimId") || "");
    const itemKey = String(form.get("itemKey") || "");
    const chaseKind = String(form.get("chaseKind") || "");
    if (intent === "prepare") {
      prepareDeskChaser({ claimId, actorId: staff.id, kind: chaseKind });
      return back(`?prepare=${encodeURIComponent(itemKey)}`);
    }
    const submitKey = formSubmitKey(form);
    const expectedVersion = String(form.get("recordVersion") || "");
    if (intent === "wait") {
      const saved = setWorkWait({
        claimId,
        itemKey,
        waitUntil: String(form.get("waitUntil") || ""),
        reason: String(form.get("reason") || ""),
        actorId: staff.id,
        role: staff.role,
        chaseKind,
        expectedVersion,
        submitKey,
      });
      return back(`?undo=${encodeURIComponent(saved.id)}`);
    }
    const outcome = String(form.get("outcome") || "");
    if (!isCallOutcome(outcome)) return back("?workError=Choose what happened on the call.");
    const saved = logDeskCall({
      claimId,
      itemKey,
      outcome,
      note: String(form.get("note") || ""),
      promiseOn: String(form.get("promiseOn") || ""),
      actorId: staff.id,
      role: staff.role,
      chaseKind,
      expectedVersion,
      submitKey,
    });
    return back(saved.waitId ? `?undo=${encodeURIComponent(saved.waitId)}` : "");
  } catch (error) {
    if (error instanceof VersionConflictError) {
      return NextResponse.redirect(new URL(pathWithClash("/", error), origin), 303);
    }
    const message = error instanceof Error ? error.message : "That could not be saved.";
    return back(`?workError=${encodeURIComponent(message)}`);
  }
}
