import { NextResponse } from "next/server";
import { getRequestStaff } from "@/lib/auth/session";
import { approveDeletionBatch, rebuildDueList, saveFinancialYearEnd, saveRetentionRule, type RetentionKey } from "@/lib/db/retention";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const form = await request.formData();
  const back = new URL("/settings/retention", origin);
  try {
    const intent = String(form.get("intent") || "");
    if (intent === "rule") {
      saveRetentionRule({ actorId: staff.id, key: String(form.get("key")) as RetentionKey, months: String(form.get("months") || ""), confirmed: form.get("confirmed") === "yes" });
    } else if (intent === "fy") {
      saveFinancialYearEnd({ actorId: staff.id, month: String(form.get("month") || "") });
    } else if (intent === "rebuild") {
      if (!(await import("@/lib/db/audit-view")).canExportAndAudit(staff.id)) throw new Error("Only Justin can check the list.");
      rebuildDueList();
    } else if (intent === "approve") {
      const items = form.getAll("item").map(String);
      if (!items.length) throw new Error("Tick the items to delete.");
      approveDeletionBatch({ actorId: staff.id, itemIds: items, reason: String(form.get("reason") || "") });
    } else {
      throw new Error("Nothing was changed.");
    }
    back.searchParams.set("saved", "1");
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "Nothing was changed.");
  }
  return NextResponse.redirect(back, 303);
}
