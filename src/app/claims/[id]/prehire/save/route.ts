import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { storeClaimDocument } from "@/lib/db/claim-documents";
import { nowUtcIso, formatUkDate } from "@/lib/dates";
import { recordClaimEvent } from "@/lib/db/chronology";
import { readUpload, recordLicenceCheck } from "@/lib/db/prehire-checks";
import { formVersion, withSectionSave } from "@/lib/db/record-version";
import { formSubmitKey, replaySubmit, storeSubmit } from "@/lib/db/submit-key";
import { run } from "@/lib/db/connection";
import { browserOrigin } from "@/lib/http/browser-origin";
import { clashRedirect } from "@/lib/http/version-clash";

function back(origin: string, claimId: string, error?: string) {
  const url = new URL(`/claims/${claimId}/hire`, origin);
  url.hash = "checks";
  if (error) url.searchParams.set("error", error);
  else url.searchParams.set("saved", "licence");
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);

  try {
    const form = await request.formData();
    const key = formSubmitKey(form);
    if (replaySubmit(key)) return back(origin, id);
    const driverKey = String(form.get("driverKey") || "");
    const checkedOn = String(form.get("checkedOn") || "");
    const uploaded = form.get("document");
    let file: { buffer: Buffer; filename: string; mimeType: string } | null = null;
    if (uploaded instanceof File && uploaded.size > 0) {
      const buffer = Buffer.from(await uploaded.arrayBuffer());
      file = { buffer, filename: uploaded.name || "licence-check.pdf", mimeType: uploaded.type || "" };
      readUpload(file);
    }
    const saved = withSectionSave({
      scope: "licence-check",
      recordKey: `${id}:${driverKey}`,
      expected: formVersion(form),
      actorId: staff.id,
      submitted: {
        result: String(form.get("result") || ""),
        category: String(form.get("category") || ""),
        penaltyPoints: String(form.get("penaltyPoints") || "0"),
        checkedOn,
      },
      labels: {
        result: "Result",
        category: "Categories",
        penaltyPoints: "Penalty points",
        checkedOn: "Date checked",
      },
      fields: {
        result: String(form.get("result") || ""),
        category: String(form.get("category") || ""),
        penaltyPoints: String(form.get("penaltyPoints") || "0"),
        checkedOn,
        notes: String(form.get("notes") || ""),
      },
      write: () => {
        const row = recordLicenceCheck({
          claimId: id,
          actorId: staff.id,
          driverKey,
          checkCode: String(form.get("checkCode") || ""),
          category: String(form.get("category") || ""),
          penaltyPoints: Number(form.get("penaltyPoints") || 0),
          licenceExpiresOn: String(form.get("licenceExpiresOn") || ""),
          checkedOn,
          result: String(form.get("result") || ""),
          notes: String(form.get("notes") || ""),
        });
        if (file) {
          const doc = storeClaimDocument({
            claimId: id,
            actorId: staff.id,
            actorRole: staff.role,
            documentType: "licence_check",
            file,
            title: `Licence check – ${row.driverName} – ${formatUkDate(`${checkedOn}T12:00:00.000Z`)}`,
            joinTransaction: true,
          });
          run(`UPDATE licence_checks SET document_id = ? WHERE id = ?`, [doc.id, row.id]);
        }
        storeSubmit(key, { id: row.id });
        return row;
      },
    });
    recordClaimEvent({
      claimId: id,
      eventType: "other",
      details: `Licence check recorded for ${saved.driverName}. Result: ${saved.result === "ok" ? "OK to drive" : "Problem found"}. No DVLA call was made.`,
      actorId: staff.id,
      occurredAt: nowUtcIso(),
      source: "staff",
    });
    return back(origin, id);
  } catch (error) {
    const refused = clashRedirect(origin, `/claims/${id}/hire`, error);
    if (refused) return refused;
    const message = error instanceof Error ? error.message : "The licence check was not saved.";
    return back(origin, id, message);
  }
}
