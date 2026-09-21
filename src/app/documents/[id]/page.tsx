import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { StoredFilePreview } from "@/components/StoredFilePreview";
import { formatUkDateTime } from "@/lib/dates";
import { requireStaff } from "@/lib/auth/session";
import { getDocument } from "@/lib/db/chronology";
import { specForTemplate } from "@/lib/documents/catalog";
import { CAS_LEGAL_SIGNOFF_NOTICE, CAS_TEMPLATE_NOTICE } from "@/lib/documents/correspondence";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  const doc = getDocument(id);
  if (!doc) notFound();
  const missing = doc.missing_json ? (JSON.parse(String(doc.missing_json)) as string[]) : [];
  const storedPath = doc.stored_relpath ? String(doc.stored_relpath) : "";
  const claimId = doc.claim_id ? String(doc.claim_id) : "";
  const fleetId = doc.fleet_vehicle_id ? String(doc.fleet_vehicle_id) : "";
  const storedFilename = String(doc.original_filename || "document.pdf");

  return (
    <div className="document-sheet mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <p className="ref text-sm text-slate">{doc.file_reference ? String(doc.file_reference) : fleetId ? "Fleet vehicle" : ""}</p>
          <h1 className="font-serif text-3xl text-navy-deep">{String(doc.title)}</h1>
          <p className="text-sm text-slate">
            Version {String(doc.version)} · {formatUkDateTime(String(doc.created_at))}
            {doc.client_name ? ` · ${String(doc.client_name)}` : ""}
            {doc.document_type ? ` · ${String(doc.document_type)}` : ""}
          </p>
        </div>
        <div className="flex gap-3">
          {claimId ? (
            <Link className="text-sm text-teal-dark underline" href={`/claims/${claimId}`}>
              Back to file
            </Link>
          ) : null}
          {fleetId ? (
            <Link className="text-sm text-teal-dark underline" href={`/hire/${fleetId}`}>
              Back to vehicle
            </Link>
          ) : null}
          {storedPath ? (
            <a className="text-sm text-teal-dark underline" href={`/documents/${id}/file`} download={storedFilename}>
              Download original
            </a>
          ) : (
            <PrintButton />
          )}
        </div>
      </div>
      {missing.length > 0 ? (
        <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm print:hidden">
          {storedPath
            ? `Fields left blank from this V5C (not guessed): ${missing.join(", ")}.`
            : `Missing from the file (shown in the letter as [not yet on file] or Unknown, not left blank): ${missing.join(", ")}.`}
        </p>
      ) : null}
      {!storedPath ? <p className="text-xs text-slate print:hidden">{CAS_TEMPLATE_NOTICE}</p> : null}
      {specForTemplate(String(doc.template_key || ""))?.legalCitations ? (
        <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm print:hidden">{CAS_LEGAL_SIGNOFF_NOTICE}</p>
      ) : null}
      {storedPath ? (
        <StoredFilePreview documentId={id} title={String(doc.title)} />
      ) : doc.body_html ? (
        <div className="letter-paper rounded-xl border border-line bg-card p-8" dangerouslySetInnerHTML={{ __html: String(doc.body_html) }} />
      ) : (
        <p>No generated body on this document.</p>
      )}
    </div>
  );
}
