import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ClaimTable";
import { formatUkDateTime, nowUtcIso } from "@/lib/dates";
import { requireStaff } from "@/lib/auth/session";
import { documentChaseTemplateKey, getPreparedFollowUpEmail, listFollowUpChases } from "@/lib/db/follow-up-chases";
import { buildMailtoHref } from "@/lib/email/mailto";
import { DOCUMENT_CHASES } from "@/lib/domain/follow-up-chases";
import {
  claimDocumentGaps,
  claimDocumentVehicleChoices,
  listClaimFileDocuments,
} from "@/lib/db/claim-documents";
import { CLAIM_DOCUMENT_TYPES } from "@/lib/domain/claim-documents";
import { getClaim } from "@/lib/db/queries";

const field = "mt-1 w-full max-w-full rounded-md border border-line bg-white px-3 py-3 text-base";

function bytes(size: number): string {
  if (size < 1024) return `${size} bytes`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function ClaimDocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireStaff();
  const { id } = await params;
  const query = await searchParams;
  const data = getClaim(id);
  if (!data) notFound();
  const documents = listClaimFileDocuments(id);
  const gaps = claimDocumentGaps(id);
  const vehicles = claimDocumentVehicleChoices(id);
  const paperChases = listFollowUpChases(nowUtcIso(), id).filter((row) => DOCUMENT_CHASES.some((paper) => paper.kind === row.kind));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents on file"
        subtitle="Upload a PDF or photograph and tag its type. A newer copy keeps the earlier one. Nothing on this page is attached to an email."
      />
      {query.error ? (
        <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">{query.error}</p>
      ) : null}
      {query.saved ? (
        <p className="rounded-md border border-teal/40 bg-[#eef8f6] px-4 py-3 text-sm">
          {query.saved === "chase" ? "Chase email updated. Nothing was sent automatically." : "Document stored on this file."}
        </p>
      ) : null}

      <section className="rounded-xl border border-line bg-card p-4">
        <h2 className="font-serif text-xl text-navy-deep">Papers to chase</h2>
        <p className="mt-1 text-sm text-slate">
          Driving licence, insurance certificate and the client&apos;s logbook (V5C) are chased every 24 hours after the client welcome is marked as
          sent. Bank statements start when the hire agreement is generated, then the same 24 hours. Uploading the paper clears the chase straight
          away. A reminder is prepared for you to send. Nothing is sent automatically.
        </p>
        {DOCUMENT_CHASES.some((paper) => paper.trigger === "welcome" && !paperChases.some((chase) => chase.kind === paper.kind)) ? (
          <p className="mt-3 text-sm">Driving licence, insurance certificate and logbook have not started. The client welcome has not been marked as sent.</p>
        ) : null}
        {paperChases.some((chase) => chase.kind === "document_bank_statements") ? null : (
          <p className="mt-3 text-sm">Bank statements have not started. The hire agreement has not been generated yet.</p>
        )}
        {paperChases.length === 0 ? null : (
          <ul className="mt-3 space-y-3">
            {paperChases.map((chase) => {
              const prepared = getPreparedFollowUpEmail(id, documentChaseTemplateKey(chase.kind));
              const mailto = prepared?.to_address && prepared.body ? buildMailtoHref(prepared.to_address, prepared.subject || chase.title, prepared.body) : null;
              return (
                <li key={chase.kind} className="rounded-lg border border-line px-3 py-3 text-sm">
                  <p className="font-semibold">{chase.title}</p>
                  <p className="text-slate">
                    {chase.outcomeOnFile ? "On file. The chase has cleared." : chase.due ? chase.label : chase.reason}
                  </p>
                  {chase.due ? (
                    <form method="post" action={`/claims/${id}/follow-up`} className="mt-2">
                      <input type="hidden" name="intent" value="prepare" />
                      <input type="hidden" name="kind" value={chase.kind} />
                      <input type="hidden" name="returnTo" value={`/claims/${id}/documents`} />
                      <button className="min-h-11 rounded-md bg-teal px-3 py-2 text-sm font-semibold text-white" type="submit">
                        Prepare chase email
                      </button>
                    </form>
                  ) : null}
                  {mailto && prepared ? (
                    <div className="mt-2">
                      <a className="text-teal-dark underline" href={mailto}>
                        Open the prepared email
                      </a>
                      <form method="post" action={`/claims/${id}/follow-up`} className="mt-2">
                        <input type="hidden" name="intent" value="mark_sent" />
                        <input type="hidden" name="kind" value={chase.kind} />
                        <input type="hidden" name="correspondenceId" value={prepared.id} />
                        <input type="hidden" name="returnTo" value={`/claims/${id}/documents`} />
                        <button className="min-h-11 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white" type="submit">
                          Mark chase as sent
                        </button>
                      </form>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="order-2 rounded-xl border border-line bg-card p-4 md:order-1">
        <h2 className="font-serif text-xl text-navy-deep">On file</h2>
        {documents.length === 0 ? <p className="mt-2 text-sm text-slate">No tagged documents stored on this file yet.</p> : null}
        <ul className="mt-3 space-y-4">
          {documents.map((doc) => (
            <li key={doc.id} className="rounded-lg border border-line px-3 py-3">
              <p className="text-sm font-semibold text-navy">
                <Link className="text-teal-dark underline" href={`/documents/${doc.id}`}>
                  {doc.typeLabel}
                </Link>{" "}
                <span className="font-normal text-slate">version {doc.version}</span>
              </p>
              <p className="text-sm text-slate">
                {doc.originalFilename} · {bytes(doc.byteSize)} · {formatUkDateTime(doc.createdAt)} · {doc.vehicleLabel}
              </p>
              <p className="mt-1 text-sm">
                <a className="text-teal-dark underline" href={`/documents/${doc.id}/file`} download={doc.originalFilename}>
                  Download
                </a>
              </p>
              <form action={`/claims/${id}/documents/upload`} method="post" encType="multipart/form-data" className="mt-3 flex flex-wrap items-end gap-3">
                <input type="hidden" name="documentType" value={doc.documentType} />
                <input type="hidden" name="replacesDocumentId" value={doc.id} />
                <label className="text-sm">
                  Store a newer copy
                  <input
                    name="document"
                    type="file"
                    required
                    accept="application/pdf,image/jpeg,image/png,image/webp,image/gif,.pdf,.jpg,.jpeg,.png,.webp,.gif"
                    className={field}
                  />
                </label>
                <button type="submit" className="rounded-md border border-line bg-white px-3 py-2 text-sm">
                  Keep this copy and add the newer one
                </button>
              </form>
              {doc.earlier.length > 0 ? (
                <ul className="mt-3 space-y-1 border-t border-line pt-2 text-sm text-slate">
                  {doc.earlier.map((older) => (
                    <li key={older.id}>
                      Earlier version {older.version}:{" "}
                      <Link className="text-teal-dark underline" href={`/documents/${older.id}`}>
                        {older.originalFilename}
                      </Link>{" "}
                      · {formatUkDateTime(older.createdAt)} ·{" "}
                      <a className="text-teal-dark underline" href={`/documents/${older.id}/file`} download={older.originalFilename}>
                        Download
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="order-1 rounded-xl border border-line bg-card p-4 md:order-2">
        <h2 className="font-serif text-xl text-navy-deep">Missing papers</h2>
        <p className="mt-1 text-sm text-slate">Still needed for known purposes. These lists are a reminder only. Storing a document does not send it.</p>
        <div className="mt-3 grid gap-4">
          {gaps.map((purpose) => (
            <div key={purpose.id}>
              <h3 className="text-sm font-semibold text-navy">{purpose.label}</h3>
              <p className="mt-1 text-xs text-slate">{purpose.detail}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {purpose.items.map((item) => (
                  <li key={item.type}>
                    {item.onFile ? "On file" : "Missing"} — {item.label}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
      </div>

      <section className="rounded-xl border border-line bg-card p-4">
        <h2 className="font-serif text-xl text-navy-deep">Store a document</h2>
        <form action={`/claims/${id}/documents/upload`} method="post" encType="multipart/form-data" className="mt-3 grid gap-3">
          <label className="text-sm">
            Type
            <select name="documentType" required className={field} defaultValue="">
              <option value="" disabled>
                Choose a type
              </option>
              {CLAIM_DOCUMENT_TYPES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Vehicle, where the type needs one
            <select name="vehicleChoice" className={field} defaultValue="">
              <option value="">Not linked to one vehicle</option>
              {vehicles.client ? <option value="client">Client&apos;s vehicle — {vehicles.client.label}</option> : null}
              {vehicles.fleet.map((vehicle) => (
                <option key={vehicle.id} value={`fleet:${vehicle.id}`}>
                  CAS vehicle — {vehicle.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            File
            <input
              name="document"
              type="file"
              required
              accept="application/pdf,image/jpeg,image/png,image/webp,image/gif,.pdf,.jpg,.jpeg,.png,.webp,.gif"
              className={field}
            />
          </label>
          <p className="text-xs text-slate">PDF or photograph, 12 MB or smaller. The type is required.</p>
          <button type="submit" className="w-fit rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
            Store on this file
          </button>
        </form>
      </section>
    </div>
  );
}
