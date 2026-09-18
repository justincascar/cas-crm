import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
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

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <p className="ref text-sm text-slate">{String(doc.file_reference)}</p>
          <h1 className="font-serif text-3xl text-navy-deep">{String(doc.title)}</h1>
          <p className="text-sm text-slate">
            Version {String(doc.version)} · {formatUkDateTime(String(doc.created_at))} · {String(doc.client_name)}
          </p>
        </div>
        <div className="flex gap-3">
          <Link className="text-sm text-teal-dark underline" href={`/claims/${doc.claim_id}`}>
            Back to file
          </Link>
          <PrintButton />
        </div>
      </div>
      {missing.length > 0 ? (
        <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm print:hidden">
          Missing from the file (shown as Unknown in the letter): {missing.join(", ")}.
        </p>
      ) : null}
      <p className="text-xs text-slate print:hidden">{CAS_TEMPLATE_NOTICE}</p>
      {specForTemplate(String(doc.template_key || ""))?.legalCitations ? (
        <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm print:hidden">{CAS_LEGAL_SIGNOFF_NOTICE}</p>
      ) : null}
      {doc.body_html ? (
        <div className="letter-paper rounded-xl border border-line bg-card p-8" dangerouslySetInnerHTML={{ __html: String(doc.body_html) }} />
      ) : (
        <p>No generated body on this document.</p>
      )}
    </div>
  );
}
