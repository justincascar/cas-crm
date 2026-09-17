import Link from "next/link";
import { PageHeader } from "@/components/ClaimTable";
import { listDocuments } from "@/lib/db/queries";

export default function DocumentsPage() {
  const docs = listDocuments();
  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle="Letters are generated from the file history dates. CAS's own templates will replace this placeholder wording. Signed originals will be preserved."
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
            {docs.map((d) => (
              <tr key={String(d.id)}>
                <td>
                  <Link className="ref text-teal-dark hover:underline" href={`/claims/${d.claim_id}`}>
                    {String(d.file_reference)}
                  </Link>
                </td>
                <td>
                  {d.body_html ? (
                    <Link className="text-teal-dark underline" href={`/documents/${d.id}`}>
                      {String(d.title)}
                    </Link>
                  ) : (
                    String(d.title)
                  )}
                </td>
                <td>{String(d.kind)}</td>
                <td>{Number(d.signed) ? "Signed copy on file" : "Unsigned"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
