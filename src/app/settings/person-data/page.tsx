import Link from "next/link";
import { PageHeader } from "@/components/ClaimTable";
import { requireStaff } from "@/lib/auth/session";
import { canUsePersonData, erasureBlock, searchPeople, searchPersonEnquiries } from "@/lib/db/person-data";
import { enquiryExportText } from "@/lib/db/website-enquiries";
import { recordView } from "@/lib/db/view-audit";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

/** "This person's data" (J15): find a person across every claim and role; export, restrict or erase. Justin only. */
export default async function PersonDataPage({ searchParams }: { searchParams: Promise<{ q?: string; error?: string; saved?: string }> }) {
  const staff = await requireStaff();
  if (!canUsePersonData(staff.id)) {
    return (
      <div className="space-y-4">
        <PageHeader title="This person's data" subtitle="Subject access, restriction and erasure" />
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">Only Justin can open a person&apos;s data.</p>
      </div>
    );
  }
  const { q, error, saved } = await searchParams;
  if (!q) recordView({ actorId: staff.id, entity: "person-data", what: "Opened the person's data screen" });
  const matches = q ? searchPeople({ actorId: staff.id, query: q }) : [];
  const enquiries = q ? searchPersonEnquiries({ actorId: staff.id, query: q }) : [];
  const action = "/settings/person-data/save";
  return (
    <div className="max-w-4xl space-y-6" data-person-data>
      <PageHeader
        title="This person's data"
        subtitle="Find everyone the CRM holds about one person, on every claim and in every role. Opening this screen, every search and every export is logged."
        actions={
          <Link href="/settings" className="text-sm text-teal-dark underline">
            Back to settings
          </Link>
        }
      />
      {error ? <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue" data-form-error>{error}</p> : null}
      {saved ? <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm text-ok">Done. It is on the history of each claim and in the audit view.</p> : null}
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-card p-4">
        <label className="min-w-64 flex-1 text-sm">
          Name, email, phone, postcode or registration
          <input name="q" defaultValue={q || ""} className={field} />
        </label>
        <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
          Search
        </button>
      </form>
      {q && matches.length === 0 && enquiries.length === 0 ? <p className="text-sm">No one matches.</p> : null}
      {enquiries.map((enquiry) => (
        <section key={enquiry.id} className="space-y-3 rounded-xl border border-line bg-card p-5" data-person-enquiry={enquiry.id}>
          <h2 className="font-serif text-lg text-navy-deep">
            {enquiry.full_name} · website enquiry {enquiry.reference}
          </h2>
          <pre className="whitespace-pre-wrap font-sans text-sm">{enquiryExportText(enquiry)}</pre>
          {enquiry.claim_id ? (
            <p className="text-sm text-slate">It became {enquiry.file_reference}. It is exported and erased with that person and claim.</p>
          ) : (
            <form method="post" action={action} className="flex flex-wrap items-end gap-2 text-sm">
              <input type="hidden" name="enquiryId" value={enquiry.id} />
              <input type="hidden" name="q" value={q || ""} />
              <input type="hidden" name="intent" value="erase-enquiry" />
              <label className="min-w-64 flex-1">
                Reason for erasing
                <input name="reason" className={field} />
              </label>
              <button type="submit" className="rounded-md bg-overdue px-3 py-2 font-semibold text-white">
                Erase this enquiry
              </button>
            </form>
          )}
        </section>
      ))}
      {matches.map((person) => {
        const block = erasureBlock(person.id);
        return (
          <section key={person.id} className="space-y-3 rounded-xl border border-line bg-card p-5" data-person={person.id}>
            <h2 className="font-serif text-lg text-navy-deep">{person.name}</h2>
            <p className="text-sm text-slate">{[person.email, person.phone, person.postcode].filter(Boolean).join(" · ") || "No contact details"}</p>
            {person.restricted ? <p className="text-sm font-semibold text-warn">Processing restricted.</p> : null}
            <ul className="text-sm">
              {person.roles.map((role) => (
                <li key={`${role.claimId}-${role.role}`}>
                  <Link href={`/claims/${role.claimId}`} className="text-teal-dark underline">
                    {role.fileReference}
                  </Link>{" "}
                  · {role.role}
                  {role.anonymised ? " · anonymised" : ""}
                </li>
              ))}
            </ul>
            <a href={`/settings/person-data/export?person=${encodeURIComponent(person.id)}`} className="inline-block rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
              Export everything held (subject access)
            </a>
            <form method="post" action={action} className="flex flex-wrap items-end gap-2 text-sm">
              <input type="hidden" name="personId" value={person.id} />
              <input type="hidden" name="q" value={q || ""} />
              <input type="hidden" name="intent" value={person.restricted ? "unrestrict" : "restrict"} />
              {person.restricted ? null : (
                <label className="min-w-64 flex-1">
                  Reason for restricting
                  <input name="reason" className={field} />
                </label>
              )}
              <button type="submit" className="rounded-md border border-line bg-white px-3 py-2">
                {person.restricted ? "Lift the restriction" : "Restrict processing"}
              </button>
            </form>
            <form method="post" action={action} className="flex flex-wrap items-end gap-2 text-sm" data-erase>
              <input type="hidden" name="personId" value={person.id} />
              <input type="hidden" name="q" value={q || ""} />
              <input type="hidden" name="intent" value="erase" />
              {block ? (
                <p className="text-slate" data-erase-blocked>
                  {block}
                </p>
              ) : (
                <>
                  <label className="min-w-64 flex-1">
                    Reason for erasing
                    <input name="reason" className={field} />
                  </label>
                  <button type="submit" className="rounded-md bg-overdue px-3 py-2 font-semibold text-white">
                    Erase this person&apos;s details
                  </button>
                </>
              )}
            </form>
          </section>
        );
      })}
    </div>
  );
}
