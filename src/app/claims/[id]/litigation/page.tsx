import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { formatUkDate, formatUkDateTime } from "@/lib/dates";
import { getClaim } from "@/lib/db/queries";
import {
  COURT_DATE_KINDS,
  LEGAL_DOCUMENT_KINDS,
  LEGAL_REVIEW_NOTE,
  PARTY_CAPACITIES,
  bundleIndex,
  canApproveLegal,
  evidenceChecklist,
  formatScheduleTotal,
  litigationChronology,
  litigationView,
  scheduleOfLoss,
} from "@/lib/db/litigation";
import { formatGbp } from "@/lib/money";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";
const box = "space-y-3 rounded-xl border border-line bg-card p-5";
const button = "rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white";

/** A claim's litigation file (J13): parties, court dates, legal documents, and working papers built from the file. */
export default async function ClaimLitigationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  const { error, saved } = await searchParams;
  const data = getClaim(id);
  if (!data) notFound();
  const view = litigationView(id);
  const action = `/claims/${id}/litigation/save`;
  const reference = String(data.claim.file_reference);
  const justin = canApproveLegal(staff.id);

  if (!view.open) {
    return (
      <div className="space-y-4">
        <h2 className="font-serif text-xl text-navy-deep">Litigation — {reference}</h2>
        <p className="text-sm">There is no litigation file on this claim. Opening one assumes nothing about who the parties are or which court it is in.</p>
        <form method="post" action={action}>
          <input type="hidden" name="intent" value="start" />
          <button type="submit" className={button}>
            Open a litigation file
          </button>
        </form>
      </div>
    );
  }

  const schedule = scheduleOfLoss(id);
  const evidence = evidenceChecklist(id);
  const bundle = bundleIndex(id);
  const chronology = litigationChronology(id);
  return (
    <div className="space-y-6" data-litigation>
      <h2 className="font-serif text-xl text-navy-deep">Litigation — {reference}</h2>
      <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">
        The CRM does not decide who is claimant or defendant, does not calculate court deadlines, and does not send or file legal documents. Every court date
        needs checking against its source by a second person. A letter before action, claim form or court document cannot be recorded as sent or filed until
        Justin approves it.
      </p>
      {error ? <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue" data-form-error>{error}</p> : null}
      {saved && !error ? <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm text-ok">Saved.</p> : null}

      <section className={box}>
        <h3 className="font-serif text-lg text-navy-deep">Court</h3>
        <form method="post" action={action} className="grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="intent" value="court" />
          <label className="text-sm">
            Court
            <input name="courtName" defaultValue={view.courtName} className={field} />
          </label>
          <label className="text-sm">
            Court reference (claim number)
            <input name="courtReference" defaultValue={view.courtReference} className={field} />
          </label>
          <button type="submit" className={`${button} self-end`}>
            Save court details
          </button>
        </form>
      </section>

      <section className={box} data-parties>
        <h3 className="font-serif text-lg text-navy-deep">Parties and representatives</h3>
        {view.parties.length ? (
          <ul className="space-y-1 text-sm">
            {view.parties.map((party) => (
              <li key={party.id}>
                <span className="font-semibold">{party.name}</span> — {party.capacity}
                {party.representative ? `. Represented by ${party.representative}` : ". No representative recorded"}
                {party.contact ? `. ${party.contact}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate">No parties recorded yet.</p>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer text-teal-dark underline">Add a party</summary>
          <form method="post" action={action} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="intent" value="party" />
            <label>
              Name
              <input name="name" required className={field} />
            </label>
            <label>
              Capacity (legal role in this claim)
              <select name="capacity" required defaultValue="" className={field}>
                <option value="" disabled>
                  Choose — nothing is assumed
                </option>
                {PARTY_CAPACITIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Representative (name)
              <input name="representativeName" className={field} />
            </label>
            <label>
              Representative (firm)
              <input name="representativeFirm" className={field} />
            </label>
            <label>
              Representative's reference
              <input name="representativeRef" className={field} />
            </label>
            <label>
              Contact details
              <input name="contact" className={field} />
            </label>
            <button type="submit" className={`${button} sm:w-fit`}>
              Add party
            </button>
          </form>
        </details>
      </section>

      <section className={box} data-court-dates>
        <h3 className="font-serif text-lg text-navy-deep">Hearings, orders and deadlines</h3>
        {view.dates.length ? (
          <ul className="space-y-2 text-sm">
            {view.dates.map((date) => (
              <li key={date.id} className="rounded-md border border-line bg-white px-3 py-2">
                <p>
                  <span className="font-semibold">{formatUkDate(date.dueOn)}</span> · {date.kind} · {date.title}
                </p>
                <p className="text-slate">Source: {date.source}</p>
                {date.calculation ? <p className="text-slate">How it was worked out: {date.calculation}</p> : null}
                {date.verifiedAt ? (
                  <p className="text-ok">Checked against its source by {date.verifiedBy} on {formatUkDateTime(date.verifiedAt)}.</p>
                ) : (
                  <form method="post" action={action} className="mt-1 flex flex-wrap items-center gap-2" data-needs-verification>
                    <span className="font-semibold text-overdue">Needs verification</span>
                    <span className="text-slate">Entered by {date.addedBy}. Someone else checks it against its source.</span>
                    <input type="hidden" name="intent" value="verify" />
                    <input type="hidden" name="dateId" value={date.id} />
                    <button type="submit" className="rounded-md border border-line bg-white px-3 py-1 text-sm">
                      I have checked it against its source
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate">No court dates recorded.</p>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer text-teal-dark underline">Record a hearing, order or deadline</summary>
          <form method="post" action={action} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="intent" value="date" />
            <label>
              Type
              <select name="kind" required defaultValue="deadline" className={field}>
                {COURT_DATE_KINDS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input name="dueOn" type="date" required className={field} />
            </label>
            <label className="sm:col-span-2">
              What it is
              <input name="title" required placeholder="For example: Defendant's defence due" className={field} />
            </label>
            <label className="sm:col-span-2">
              Where it comes from
              <input name="source" required placeholder="For example: order of DJ … dated …, paragraph 3" className={field} />
            </label>
            <label className="sm:col-span-2">
              How it was worked out (required for a deadline; the CRM does not calculate it)
              <input name="calculation" placeholder="For example: 14 days after service on …, as stated in the order" className={field} />
            </label>
            <button type="submit" className={`${button} sm:w-fit`}>
              Record it
            </button>
          </form>
        </details>
      </section>

      <section className={box} data-legal-documents>
        <h3 className="font-serif text-lg text-navy-deep">Legal documents</h3>
        <p className="text-sm text-slate">Letters before action, claim forms and court documents are prepared outside the CRM and filed here. The CRM sends and files nothing.</p>
        {view.documents.length ? (
          <ul className="space-y-2 text-sm">
            {view.documents.map((doc) => (
              <li key={doc.id} className="rounded-md border border-line bg-white px-3 py-2">
                <p>
                  <Link href={`/documents/${doc.documentId}`} className="font-semibold text-teal-dark underline">
                    {doc.title}
                  </Link>{" "}
                  · {doc.kind} · Needs qualified legal review
                </p>
                {doc.approvedAt ? <p className="text-ok">Approved by {doc.approvedBy} on {formatUkDateTime(doc.approvedAt)}.</p> : <p className="font-semibold text-overdue">Not approved by Justin.</p>}
                {!doc.approvedAt && justin ? (
                  <form method="post" action={action}>
                    <input type="hidden" name="intent" value="approve" />
                    <input type="hidden" name="legalDocumentId" value={doc.id} />
                    <button type="submit" className="mt-1 rounded-md border border-line bg-white px-3 py-1 text-sm">
                      Approve (Justin)
                    </button>
                  </form>
                ) : null}
                {doc.sentOrFiledAt ? (
                  <p>Sent or filed on {formatUkDateTime(doc.sentOrFiledAt)}: {doc.sentOrFiledHow}</p>
                ) : doc.approvedAt ? (
                  <form method="post" action={action} className="mt-1 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="intent" value="sent" />
                    <input type="hidden" name="legalDocumentId" value={doc.id} />
                    <label>
                      How and where it was sent or filed
                      <input name="how" required className={field} />
                    </label>
                    <button type="submit" className="rounded-md border border-line bg-white px-3 py-2 text-sm">
                      Record as sent or filed
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <details className="text-sm">
          <summary className="cursor-pointer text-teal-dark underline">File a legal document</summary>
          <form method="post" action={action} encType="multipart/form-data" className="mt-3 grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="intent" value="document" />
            <label>
              Kind
              <select name="kind" required defaultValue="" className={field}>
                <option value="" disabled>
                  Choose
                </option>
                {LEGAL_DOCUMENT_KINDS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Title
              <input name="title" required className={field} />
            </label>
            <label>
              File
              <input name="document" type="file" required className={field} />
            </label>
            <button type="submit" className={`${button} sm:w-fit`}>
              File it
            </button>
          </form>
        </details>
      </section>

      <section className={box} data-schedule>
        <h3 className="font-serif text-lg text-navy-deep">Schedule of loss</h3>
        <p className="text-xs text-slate">{LEGAL_REVIEW_NOTE} Offers are not payments, and the columns are never added together.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate">
                <th className="py-1">Head of loss</th>
                <th>Claimed</th>
                <th>Offered</th>
                <th>Agreed</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((row) => (
                <tr key={row.head} className="border-t border-line">
                  <td className="py-1">{row.head}</td>
                  <td>{formatGbp(row.claimedPence)}</td>
                  <td>{formatGbp(row.offeredPence)}</td>
                  <td>{formatGbp(row.agreedPence)}</td>
                  <td>{formatGbp(row.paidPence)}</td>
                </tr>
              ))}
              <tr className="border-t border-line font-semibold">
                <td className="py-1">Each column</td>
                <td>{formatScheduleTotal(schedule, "claimedPence")}</td>
                <td>{formatScheduleTotal(schedule, "offeredPence")}</td>
                <td>{formatScheduleTotal(schedule, "agreedPence")}</td>
                <td>{formatScheduleTotal(schedule, "paidPence")}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className={box} data-evidence>
        <h3 className="font-serif text-lg text-navy-deep">Evidence checklist</h3>
        <p className="text-xs text-slate">{LEGAL_REVIEW_NOTE}</p>
        <ul className="space-y-1 text-sm">
          {evidence.map((item) => (
            <li key={item.label}>
              <span className={item.held ? "text-ok" : "font-semibold text-overdue"}>{item.held ? "On file" : "Missing"}</span> — {item.label}: {item.detail}
              {item.when ? ` (${formatUkDate(item.when)})` : ""}
            </li>
          ))}
        </ul>
      </section>

      <section className={box} data-bundle>
        <h3 className="font-serif text-lg text-navy-deep">Bundle index (draft)</h3>
        <p className="text-xs text-slate">{LEGAL_REVIEW_NOTE} Not paginated.</p>
        <ol className="space-y-1 text-sm">
          {bundle.map((entry) => (
            <li key={entry.documentId}>
              {entry.tab}. {entry.section} — {entry.title} ({entry.date})
            </li>
          ))}
        </ol>
      </section>

      <section className={box} data-chronology>
        <h3 className="font-serif text-lg text-navy-deep">Chronology</h3>
        <p className="text-xs text-slate">{LEGAL_REVIEW_NOTE} A letter before action is left out of this list.</p>
        <ul className="space-y-1 text-sm">
          {chronology.map((line) => (
            <li key={line.id}>
              {line.date} — {line.text}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
