import { get } from "@/lib/db/connection";
import { storeHireBankStatement } from "@/lib/db/prehire-checks";
import { claimSectionForSave, formVersion } from "@/lib/db/record-version";
import { officeHirePost } from "@/lib/http/hire-post";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return officeHirePost(request, context, async ({ id, staffId, staffRole, form, key }) => {
    const uploaded = form.get("document");
    if (!(uploaded instanceof File) || uploaded.size < 1) throw new Error("Choose a bank statement to store.");
    const period = String(form.get("statementPeriod") || "");
    const client = get<{ full_name: string | null }>(
      `SELECT p.full_name FROM claims c JOIN people p ON p.id = c.client_person_id WHERE c.id = ?`,
      [id],
    );
    claimSectionForSave({
      scope: "bank-check",
      recordKey: id,
      expected: formVersion(form),
      actorId: staffId,
      submitted: { statementPeriod: period },
      labels: { statementPeriod: "Statement period" },
      fields: { statementPeriod: period },
    });
    storeHireBankStatement({
      claimId: id,
      actorId: staffId,
      actorRole: staffRole,
      clientName: String(client?.full_name || form.get("clientName") || "Client"),
      period,
      submitKey: key,
      file: {
        buffer: Buffer.from(await uploaded.arrayBuffer()),
        filename: uploaded.name || "statement.pdf",
        mimeType: uploaded.type || "",
      },
    });
  });
}
