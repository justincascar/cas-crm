import Link from "next/link";
import { PageHeader } from "@/components/ClaimTable";
import { requireStaff } from "@/lib/auth/session";
import { listDocuments } from "@/lib/db/queries";
import { documentHasGeneratedBody, documentListSignedLabel, DOCUMENT_PLACEHOLDER_NOTE } from "@/lib/documents/list-display";

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
              const onFile = documentHasGeneratedBody(d.body_html);
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
                  <td>{String(d.kind)}</td>
                  <td>{documentListSignedLabel(d)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
