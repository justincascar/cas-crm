import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { actOnFirstLetter, firstLettersView, type FirstLetterIntent } from "@/lib/db/first-letters";
import { browserOrigin } from "@/lib/http/browser-origin";

/** R63: generate, send (simulated until the mailbox is live) or mark sent one first letter, or send them all. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const form = await request.formData();
  const back = new URL(`/claims/${id}/first-letters`, origin);
  const key = String(form.get("templateKey") || "");
  const intent = String(form.get("intent") || "");
  const accountLine = String(form.get("accountLine") || "").trim().slice(0, 400);
  try {
    if (intent === "send_all") {
      const view = firstLettersView(id);
      const ready = (view?.items || []).filter((item) => item.approved && !item.waitingWording && (!item.done || item.done.action === "generated") && item.to && item.missing.length === 0);
      if (!ready.length) throw new Error("Nothing is ready to send: each letter needs Justin's approval (drafts), an email address and nothing missing.");
      const results: string[] = [];
      for (const item of ready) {
        const done = await actOnFirstLetter({ claimId: id, actorId: staff.id, key: item.key, intent: "send", accountLine });
        results.push(done.outcome);
      }
      back.searchParams.set("done", results.join(" ").slice(0, 600));
    } else if (["generate", "send", "mark_sent"].includes(intent)) {
      const done = await actOnFirstLetter({
        claimId: id,
        actorId: staff.id,
        key,
        intent: intent as FirstLetterIntent,
        to: form.has("to") ? String(form.get("to") || "") : undefined,
        cc: form.has("cc") ? String(form.get("cc") || "") : undefined,
        accountLine,
      });
      back.searchParams.set("done", done.outcome.slice(0, 600));
    } else {
      throw new Error("Nothing was changed.");
    }
  } catch (error) {
    back.searchParams.set("error", (error instanceof Error ? error.message : "That could not be done.").slice(0, 500));
  }
  back.hash = key ? `letter-${key}` : "";
  return NextResponse.redirect(back, 303);
}
