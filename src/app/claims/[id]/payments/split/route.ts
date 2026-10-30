import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { recordSplitPayment } from "@/lib/db/payment-ledger";
import { formSubmitKey } from "@/lib/db/submit-key";
import { optionalPoundsToPence } from "@/lib/domain/total-loss";
import { browserOrigin } from "@/lib/http/browser-origin";

const SPLIT_PAYMENT_HEADS = ["recovery", "storage", "hire", "repairs", "vehicle_damage"] as const;

/** One payment covering several heads of loss, split by head before it is recorded (J11). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const back = new URL(`/claims/${id}/money`, origin);
  try {
    const form = await request.formData();
    const pence = (name: string) => optionalPoundsToPence(String(form.get(name) || "")) || 0;
    recordSplitPayment({
      claimId: id,
      actorId: staff.id,
      totalPence: pence("total"),
      parts: SPLIT_PAYMENT_HEADS.map((head) => ({ head, pence: pence(`split_${head}`) })),
      submitKey: formSubmitKey(form),
      payingByCard: form.get("payingByCard") === "yes",
    });
    back.searchParams.set("saved", "split");
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "The payment was not recorded.");
  }
  back.hash = "split-payment";
  return NextResponse.redirect(back, 303);
}
