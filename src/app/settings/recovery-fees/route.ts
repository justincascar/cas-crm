import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { RECOVERY_FEE_DEFS, poundsToStoredPence } from "@/lib/domain/recovery-fees";
import { setRecoveryCardFeePercent, setRecoveryFeePence } from "@/lib/db/recovery-fee-settings";
import { formVersion, withSectionSave } from "@/lib/db/record-version";
import { browserOrigin } from "@/lib/http/browser-origin";
import { clashRedirect } from "@/lib/http/version-clash";

export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const back = new URL("/settings", origin);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const fee of RECOVERY_FEE_DEFS) fields[fee.settingKey] = String(form.get(fee.settingKey) || "");
  const cardFee = form.get("recovery_card_fee_percent");
  if (cardFee !== null) fields.recovery_card_fee_percent = String(cardFee);
  try {
    withSectionSave({
      scope: "settings-recovery-fees",
      recordKey: "office",
      expected: formVersion(form),
      actorId: staff.id,
      submitted: fields,
      labels: { ...Object.fromEntries(RECOVERY_FEE_DEFS.map((fee) => [fee.settingKey, fee.label])), recovery_card_fee_percent: "Card fee (%)" },
      fields,
      write: () => {
        for (const fee of RECOVERY_FEE_DEFS) {
          setRecoveryFeePence(fee.key, poundsToStoredPence(fields[fee.settingKey]));
        }
        if (fields.recovery_card_fee_percent !== undefined) setRecoveryCardFeePercent(fields.recovery_card_fee_percent);
      },
    });
  } catch (error) {
    const refused = clashRedirect(origin, "/settings", error);
    if (refused) return refused;
    back.searchParams.set("error", error instanceof Error ? error.message : "The recovery fees could not be saved.");
    return NextResponse.redirect(back, 303);
  }
  back.searchParams.set("saved", "recovery-fees");
  return NextResponse.redirect(back, 303);
}
