import Link from "next/link";
import { PageHeader } from "@/components/ClaimTable";
import { requireStaff } from "@/lib/auth/session";
import { listDocuments } from "@/lib/db/queries";
import { claimDocumentTypeLabel } from "@/lib/domain/claim-documents";
import { documentHasGeneratedBody, documentIsStoredFile, documentListSignedLabel, DOCUMENT_PLACEHOLDER_NOTE } from "@/lib/documents/list-display";
import { agreementDocumentState, agreementStateLabel } from "@/lib/db/agreement-state";
import { documentKindLabel } from "@/lib/documents/kind-label";

export default async function DocumentsPage() {
  await requireStaff();
  const docs = listDocuments();
  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle="Letters generated from a file use CAS's supplied templates and can be opened here. Empty rows are simulated placeholders, not stored originals."
      />
      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Document</th>
              <th>Kind</th>
              <th>Signed</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => {
              const stored = documentIsStoredFile(d);
              const onFile = documentHasGeneratedBody(d.body_html) || stored;
              const typeLabel = claimDocumentTypeLabel(String(d.document_type || ""));
              // R43: a produced agreement is signed through its separate signed copy, or replaced by a later agreement.
              const agreementLabel = agreementStateLabel(
                agreementDocumentState({ id: String(d.id), claim_id: String(d.claim_id), template_key: d.template_key ? String(d.template_key) : null, created_at: String(d.created_at) }),
              );
              return (
                <tr key={String(d.id)}>
                  <td>
                    <Link className="ref text-teal-dark hover:underline" href={`/claims/${d.claim_id}`}>
                      {String(d.file_reference)}
                    </Link>
                  </td>
                  <td>
                    {onFile ? (
                      <Link className="text-teal-dark underline" href={`/documents/${d.id}`}>
                        {String(d.title)}
                      </Link>
                    ) : (
                      <span>
                        {String(d.title)}
                        <span className="mt-1 block text-xs text-slate">{DOCUMENT_PLACEHOLDER_NOTE}</span>
                      </span>
                    )}
                  </td>
                  <td>{typeLabel || documentKindLabel(d)}</td>
                  <td>{agreementLabel || documentListSignedLabel(d)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
