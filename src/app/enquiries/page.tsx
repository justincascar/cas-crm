import Link from "next/link";
import { PageHeader } from "@/components/ClaimTable";
import { requireStaff } from "@/lib/auth/session";
import { formatUkDate, formatUkDateTime } from "@/lib/dates";
import { listClosedEnquiries, listOpenEnquiries, type EnquiryView } from "@/lib/db/website-enquiries";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

function Details({ enquiry }: { enquiry: EnquiryView }) {
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[11rem_1fr]">
      <dt className="text-slate">Mobile</dt>
      <dd>
        <a href={`tel:${enquiry.mobile.replace(/\s/g, "")}`} className="font-semibold text-navy underline">
          {enquiry.mobile}
        </a>
      </dd>
      <dt className="text-slate">Registration</dt>
      <dd className="font-semibold">{enquiry.registration}</dd>
      <dt className="text-slate">Accident date</dt>
      <dd>{formatUkDate(enquiry.accident_date)}</dd>
      <dt className="text-slate">Whose fault</dt>
      <dd>{enquiry.faultLabel}</dd>
      <dt className="text-slate">Can the car be driven</dt>
      <dd>{enquiry.driveableLabel}</dd>
      <dt className="text-slate">What happened</dt>
      <dd className="whitespace-pre-line">{enquiry.what_happened || "Left blank"}</dd>
      <dt className="text-slate">Privacy notice</dt>
      <dd>Ticked {formatUkDateTime(enquiry.consent_at)}</dd>
    </dl>
  );
}

/** Website enquiries (J16): the website's "Start your claim" form, waiting for a call. Office staff. */
export default async function WebsiteEnquiriesPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  await requireStaff();
  const { error, saved } = await searchParams;
  const open = listOpenEnquiries();
  const closed = listClosedEnquiries();
  const action = "/enquiries/save";
  return (
    <div className="max-w-4xl space-y-6" data-website-enquiries>
      <PageHeader title="Website enquiries" subtitle="From the website's Start your claim form. Call each person, then convert it to a claim or close it." />
      {error ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue" data-form-error>
          {error}
        </p>
      ) : null}
      {saved ? <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm text-ok">Saved.</p> : null}

      <h2 className="font-serif text-xl text-navy-deep">Needs a call ({open.length})</h2>
      {open.length === 0 ? <p className="text-sm text-slate">No enquiries are waiting.</p> : null}
      {open.map((enquiry) => (
        <section
          key={enquiry.id}
          className={`space-y-3 rounded-xl border border-line border-l-4 bg-card p-5 ${enquiry.urgent ? "border-l-overdue" : "border-l-warn"}`}
          data-enquiry={enquiry.reference}
          data-urgent={enquiry.urgent ? "yes" : "no"}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-serif text-lg text-navy-deep">{enquiry.full_name}</h3>
            <p className="text-sm text-slate">
              {enquiry.reference} · received {formatUkDateTime(enquiry.received_at)}
            </p>
          </div>
          <p className={`text-sm font-semibold ${enquiry.urgent ? "text-overdue" : "text-warn"}`} data-enquiry-status>
            {enquiry.urgent ? "Urgent: the car can't be driven · " : ""}
            {enquiry.statusLabel}
          </p>
          <Details enquiry={enquiry} />
          <div className="flex flex-wrap items-start gap-3">
            <form method="post" action={action}>
              <input type="hidden" name="intent" value="convert" />
              <input type="hidden" name="enquiryId" value={enquiry.id} />
              <button type="submit" className="min-h-11 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
                {enquiry.draft_open ? "Continue the claim" : "Convert to claim"}
              </button>
            </form>
            <details className="text-sm">
              <summary className="min-h-11 cursor-pointer rounded-md border border-line bg-white px-4 py-2.5 font-semibold text-navy">Not proceeding</summary>
              <form method="post" action={action} className="mt-2 flex flex-wrap items-end gap-2">
                <input type="hidden" name="intent" value="close" />
                <input type="hidden" name="enquiryId" value={enquiry.id} />
                <label className="min-w-64 flex-1">
                  Reason
                  <input name="reason" required maxLength={500} className={field} />
                </label>
                <button type="submit" className="rounded-md border border-line bg-white px-3 py-2">
                  Close the enquiry
                </button>
              </form>
            </details>
          </div>
        </section>
      ))}

      {closed.length ? (
        <details className="rounded-xl border border-line bg-card p-5" data-closed-enquiries>
          <summary className="cursor-pointer font-serif text-lg text-navy-deep">Closed ({closed.length})</summary>
          <ul className="mt-3 space-y-3 text-sm">
            {closed.map((enquiry) => (
              <li key={enquiry.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3" data-enquiry={enquiry.reference}>
                <span>
                  <span className="font-semibold">{enquiry.full_name}</span> · {enquiry.registration} · {enquiry.reference} ·{" "}
                  {enquiry.claim_id ? (
                    <Link href={`/claims/${enquiry.claim_id}`} className="text-teal-dark underline">
                      {enquiry.statusLabel}
                    </Link>
                  ) : (
                    <>
                      {enquiry.statusLabel}: {enquiry.closed_reason}
                    </>
                  )}
                  {enquiry.closed_at ? (
                    <span className="text-slate">
                      {" "}
                      · {formatUkDateTime(enquiry.closed_at)}
                      {enquiry.closed_by_name ? ` by ${enquiry.closed_by_name}` : ""}
                    </span>
                  ) : null}
                </span>
                {enquiry.status === "not_proceeding" ? (
                  <form method="post" action={action}>
                    <input type="hidden" name="intent" value="reopen" />
                    <input type="hidden" name="enquiryId" value={enquiry.id} />
                    <button type="submit" className="rounded-md border border-line bg-white px-3 py-1.5">
                      Reopen
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
