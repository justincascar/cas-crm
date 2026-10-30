import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import {
  addCourtDate,
  addLegalDocument,
  addLitigationParty,
  approveLegalDocument,
  markLegalDocumentSentOrFiled,
  saveCourtDetails,
  setInstructedSolicitor,
  startLitigation,
  verifyCourtDate,
} from "@/lib/db/litigation";
import { liftLegalHold, setLegalHold } from "@/lib/db/retention";
import { browserOrigin } from "@/lib/http/browser-origin";

/** Every change on a claim's litigation file (J13). Each records who did it. Nothing is sent or filed from here. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const back = new URL(`/claims/${id}/litigation`, origin);
  try {
    const form = await request.formData();
    const text = (name: string) => String(form.get(name) || "");
    const intent = text("intent");
    const base = { claimId: id, actorId: staff.id };
    if (intent === "start") startLitigation(base);
    else if (intent === "hold") setLegalHold({ ...base, reason: text("reason") });
    else if (intent === "unhold") liftLegalHold(base);
    else if (intent === "solicitor") setInstructedSolicitor({ ...base, staffId: text("staffId") });
    else if (intent === "court") saveCourtDetails({ ...base, courtName: text("courtName"), courtReference: text("courtReference") });
    else if (intent === "party") {
      addLitigationParty({
        ...base,
        name: text("name"),
        capacity: text("capacity"),
        representativeName: text("representativeName"),
        representativeFirm: text("representativeFirm"),
        representativeRef: text("representativeRef"),
        contact: text("contact"),
      });
    } else if (intent === "date") {
      addCourtDate({ ...base, kind: text("kind"), title: text("title"), dueOn: text("dueOn"), source: text("source"), calculation: text("calculation") });
    } else if (intent === "verify") verifyCourtDate({ ...base, dateId: text("dateId") });
    else if (intent === "document") {
      const file = form.get("document");
      if (!(file instanceof File) || file.size === 0) throw new Error("Choose the document to upload.");
      addLegalDocument({ ...base, kind: text("kind"), title: text("title"), file: { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name, mimeType: file.type } });
    } else if (intent === "approve") approveLegalDocument({ ...base, legalDocumentId: text("legalDocumentId") });
    else if (intent === "sent") markLegalDocumentSentOrFiled({ ...base, legalDocumentId: text("legalDocumentId"), how: text("how") });
    else throw new Error("That change could not be saved.");
    back.searchParams.set("saved", intent);
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "That change was not saved.");
  }
  return NextResponse.redirect(back, 303);
}
