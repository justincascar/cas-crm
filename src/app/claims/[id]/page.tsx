import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { actionAddNote, actionAddTask, actionCompleteTask, actionUpdateClaim } from "@/app/actions";
import { FileHistory } from "@/components/FileHistory";
import { ClaimAudatexFields } from "@/components/ClaimAudatexFields";
import { ClaimWorkflowStatus } from "@/components/ClaimWorkflowStatus";
import { ChasePanel } from "@/components/ChasePanel";
import { PageHeader } from "@/components/ClaimTable";
import { ValidatedForm } from "@/components/ValidatedForm";
import { formatUkDate, formatUkDateTime } from "@/lib/dates";
import { requireStaff } from "@/lib/auth/session";
import { getClaim, listStaff, suggestAudatexCodesForClaim } from "@/lib/db/queries";
import { findPreparedChase, listChasesForClaim } from "@/lib/db/chase";
import { listHireAgreements } from "@/lib/db/chronology";
import { formatGbp } from "@/lib/money";
import { HEAD_LABELS, type HeadOfLoss } from "@/lib/constants";
import { formatVehicleRegistration } from "@/lib/text";
import { googleMapsSearchUrl } from "@/lib/lookups/maps";
import { liabilityStatusLabel, roadworthinessLabel } from "@/lib/domain/claim-status";
import { describeHireAgreementParts } from "@/lib/documents/hire-agreement-parts";
import { HireEndDateReview } from "@/components/claims/HireEndDateReview";
import { TotalLossPanel } from "@/components/claims/TotalLossPanel";
import { StorageDateReview } from "@/components/claims/StorageDateReview";
import { StorageEndDateReview } from "@/components/claims/StorageEndDateReview";
import { getHireEndDateReviews } from "@/lib/db/hire-collection-date";
import { getStorageDateReview, getStorageEndDateReview } from "@/lib/db/storage-recovery-date";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

function pretty(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "Unknown";
  return String(value).replaceAll("_", " ");
}

export default async function ClaimDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tlError?: string }>;
}) {
  const { id } = await params;
  const { tlError } = await searchParams;
  await requireStaff();
  const data = getClaim(id);
  if (!data) notFound();
  const { claim } = data;
  const staff = listStaff();
  const audatexSuggestion = suggestAudatexCodesForClaim(String(claim.id));
  const chases = listChasesForClaim(String(claim.id));
  const hireAgreements = listHireAgreements(String(claim.id));
  const preparedByKind = Object.fromEntries(
    chases.map((chase) => {
      const row = findPreparedChase(chase.kind, String(claim.id));
      return [
        chase.kind,
        row
          ? {
              id: String(row.id),
              subject: row.subject,
              to_address: row.to_address,
              body: row.body,
              created_at: String(row.created_at),
            }
          : null,
      ];
    }),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${claim.file_reference}`}
        subtitle={`${claim.client_name || "Unknown client"} · ${liabilityStatusLabel(String(claim.claim_type))} · ${roadworthinessLabel(String(claim.roadworthiness))} · ${claim.handler_name || "Unassigned"}`}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link href={`/claims/${claim.id}/work/comms`} className="rounded-md bg-navy px-4 py-2.5 font-semibold text-white">
              Email / calls
            </Link>
            <Link href={`/claims/${claim.id}/work/general`} className="rounded-md border border-navy px-4 py-2.5 font-semibold text-navy">
              File screens
            </Link>
            <Link href={`/claims/${claim.id}/hire-pack`} className="rounded-md bg-teal px-4 py-2.5 font-semibold text-white">
              Hire Pack
            </Link>
            <Link href="/claims" className="text-teal-dark underline">
              All claims
            </Link>
          </div>
        }
      />

      <ClaimWorkflowStatus
        claimId={String(claim.id)}
        liabilityStatus={String(claim.claim_type || "")}
        roadworthiness={String(claim.roadworthiness || "")}
      />

      {chases.map((chase) => (
        <ChasePanel
          key={chase.kind}
          claimId={String(claim.id)}
          chase={chase}
          prepared={preparedByKind[chase.kind] || null}
          agreements={chase.kind === "hire_agreement_renewal" ? hireAgreements : undefined}
        />
      ))}

      <ClaimAudatexFields
        claimId={String(claim.id)}
        insurerName={audatexSuggestion.insurerName}
        networkCode={String(claim.audatex_network_code || "")}
        workProviderCode={String(claim.audatex_work_provider_code || "")}
        suggestedNetwork={audatexSuggestion.network}
        suggestedWorkProvider={audatexSuggestion.workProvider}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border-2 border-navy bg-[#e8eef4] px-5 py-4">
          <div>
            <p className="font-serif text-xl text-navy-deep">Email, WhatsApp and calls</p>
            <p className="text-sm text-slate">Send and file correspondence, record calls, and generate letters on this file.</p>
          </div>
          <Link href={`/claims/${claim.id}/work/comms`} className="rounded-md bg-navy px-5 py-3 text-sm font-semibold text-white">
            Open communications
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border-2 border-line bg-card px-5 py-4">
          <div>
            <p className="font-serif text-xl text-navy-deep">File screens</p>
            <p className="text-sm text-slate">Client, vehicle, hire, recovery and money — without repeating the same facts on extra screens.</p>
          </div>
          <Link href={`/claims/${claim.id}/work/general`} className="rounded-md bg-white px-5 py-3 text-sm font-semibold text-navy ring-1 ring-navy">
            Open screens
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border-2 border-teal bg-[#e8f4f2] px-5 py-4">
          <div>
            <p className="font-serif text-xl text-navy-deep">Hire Pack</p>
            <p className="text-sm text-slate">Collect delivery, agreement and collection details, then generate the pack for this file.</p>
          </div>
          <Link href={`/claims/${claim.id}/hire-pack`} className="rounded-md bg-teal px-5 py-3 text-sm font-semibold text-white">
            Open Hire Pack
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Fact label="Current position" value={String(claim.current_position)} />
        <Fact label="Liability status" value={liabilityStatusLabel(String(claim.claim_type))} />
        <Fact label="Roadworthiness" value={roadworthinessLabel(String(claim.roadworthiness))} />
        <Fact label="CAS liability view" value={pretty(claim.cas_liability_assessment)} />
        <Fact label="Insurer position" value={pretty(claim.insurer_liability_position)} />
        <Fact label="Client role" value={pretty(claim.client_role)} />
        <Fact label="Police attended" value={pretty(claim.police_attended)} />
        <Fact label="Needs recovery" value={Number(claim.needs_recovery) ? "Yes" : "No"} />
        <Fact label="Weather" value={pretty(claim.weather_conditions)} />
      </div>

      {Number(claim.replacement_need_review) === 1 ? (
        <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">
          This file was later declared a total loss after an earlier roadworthy assessment. Replacement-need is flagged for staff — no start rule has been invented.
        </p>
      ) : null}

      {claim.accident_location ? (
        <p className="text-sm">
          Accident at {String(claim.accident_location)}
          {googleMapsSearchUrl(String(claim.accident_location)) ? (
            <>
              {" · "}
              <a
                className="text-teal-dark underline"
                href={googleMapsSearchUrl(String(claim.accident_location))}
                target="_blank"
                rel="noreferrer"
              >
                View on Google Maps
              </a>
            </>
          ) : null}
          {claim.journey_purpose ? ` · Journey: ${String(claim.journey_purpose)}` : ""}
          {claim.client_speed ? ` · Client speed: ${String(claim.client_speed)}` : ""}
          {claim.tp_speed ? ` · TP speed: ${String(claim.tp_speed)}` : ""}
          {claim.police_ref ? ` · Police ref: ${String(claim.police_ref)}` : ""}
        </p>
      ) : null}

      <FileHistory
        claimId={String(claim.id)}
        handlerId={String(claim.handler_id || "staff-sian")}
        events={data.events}
        keyDates={data.keyDates}
        correspondence={data.correspondence}
        documents={data.documents}
        liabilityStatus={String(claim.claim_type || "")}
      />

      <section className="grid gap-6 xl:grid-cols-3">
        <form action={actionUpdateClaim} className="space-y-3 rounded-xl border border-line bg-card p-5 xl:col-span-2">
          <input type="hidden" name="claimId" value={String(claim.id)} />
          <h2 className="font-serif text-xl text-navy-deep">Claim facts</h2>
          <p className="text-xs text-slate">Staff-reviewed fields. Client-entered material stays in notes and the form status until reviewed.</p>
          <label className="block text-sm">
            Current position
            <input name="current_position" className={field} defaultValue={String(claim.current_position || "")} />
          </label>
          <label className="block text-sm">
            Circumstances
            <textarea name="circumstances" rows={3} className={field} defaultValue={String(claim.circumstances || "")} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Location
              <input name="accident_location" className={field} defaultValue={String(claim.accident_location || "")} />
            </label>
            <label className="block text-sm">
              Next action
              <input name="next_action" className={field} defaultValue={String(claim.next_action || "")} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              CAS assessment
              <select name="cas_liability_assessment" className={field} defaultValue={String(claim.cas_liability_assessment || "unknown")}>
                <option value="unknown">Unknown</option>
                <option value="non_fault">Non-fault</option>
                <option value="fault">Fault</option>
                <option value="mixed">Mixed</option>
              </select>
            </label>
            <label className="block text-sm">
              Insurer position
              <select name="insurer_liability_position" className={field} defaultValue={String(claim.insurer_liability_position || "pending")}>
                <option value="pending">Pending</option>
                <option value="admitted">Admitted</option>
                <option value="denied">Denied</option>
                <option value="partial">Partial</option>
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Handler
              <select name="handler_id" className={field} defaultValue={String(claim.handler_id || "")}>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm">
            Roadworthiness reasons
            <textarea name="roadworthiness_reasons" rows={2} className={field} defaultValue={String(claim.roadworthiness_reasons || "")} />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm">
              Own insurer
              <input name="own_insurer_name" className={field} defaultValue={String(claim.own_insurer_name || "")} />
            </label>
            <label className="block text-sm">
              Policy ref
              <input name="own_policy_ref" className={field} defaultValue={String(claim.own_policy_ref || "")} />
            </label>
            <label className="block text-sm">
              Insurer claim ref
              <input name="own_claim_ref" className={field} defaultValue={String(claim.own_claim_ref || "")} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Own insurer address
              <textarea name="own_insurer_address" rows={2} className={field} defaultValue={String(claim.own_insurer_address || "")} />
            </label>
            <label className="block text-sm">
              Own insurer postcode
              <input name="own_insurer_postcode" className={field} defaultValue={String(claim.own_insurer_postcode || "")} />
            </label>
          </div>
          <label className="block text-sm">
            Next action due (ISO date/time)
            <input name="next_action_due" className={field} defaultValue={String(claim.next_action_due || "")} />
          </label>
          <button className="rounded-md bg-navy px-4 py-2 text-sm text-white" type="submit">
            Save changes
          </button>
        </form>

        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-card p-5">
            <h2 className="font-serif text-xl text-navy-deep">Client</h2>
            <p className="mt-2 text-sm">
              {String(claim.client_name)} ({pretty(claim.client_kind)}) · {pretty(claim.client_role)}
              <br />
              DOB: {claim.date_of_birth ? formatUkDate(String(claim.date_of_birth)) : "Unknown"}
              <br />
              {pretty(claim.address_line1)}, {pretty(claim.town)} {pretty(claim.postcode)}
              <br />
              Mobile {pretty(claim.mobile_tel || claim.telephone)} · Other {Number(claim.other_contact_skipped) ? "skipped" : pretty(claim.home_tel)}
              <br />
              {pretty(claim.email)}
              <br />
              Preferred: {pretty(claim.preferred_channel)}
            </p>
            <p className="mt-3 text-xs text-slate">
              Driving licence (restricted): {String(claim.licence_number || "Not held on this prototype record")}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-card p-5">
            <h2 className="font-serif text-xl text-navy-deep">Client vehicle</h2>
            <p className="mt-2 text-sm">
              {claim.registration ? formatVehicleRegistration(String(claim.registration)) : "Unknown"} · {pretty(claim.make)} {pretty(claim.model)} · {pretty(claim.colour)}
              <br />
              Gearbox: {pretty(claim.transmission)} · Fuel: {pretty(claim.fuel)} · Seats: {String(claim.seats ?? "Unknown")}
              <br />
              Tax: {pretty(claim.tax_status)} · MOT: {pretty(claim.mot_status)}
              <br />
              Insurance recorded: {pretty(claim.insurance_recorded)} · Details match client: {Number(claim.details_match_client) ? "Yes" : "Not confirmed"}
              <br />
              Source: {pretty(claim.lookup_source)} {Number(claim.lookup_incomplete) === 1 ? "(incomplete — do not infer missing fields)" : ""}
            </p>
            {claim.damage_description ? <p className="mt-3 text-sm">Damage: {String(claim.damage_description)}</p> : null}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Linked roles</h2>
        <p className="mb-3 text-sm text-slate">One person can hold several roles without retyping.</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {data.parties.map((p) => (
            <li key={`${p.id}-${p.role}`} className="text-sm">
              <strong>{pretty(p.role)}</strong>: {String(p.full_name)}
            </li>
          ))}
        </ul>
      </section>

      {data.thirdParties.length > 0 ? (
        <section className="rounded-xl border border-line bg-card p-5">
          <h2 className="font-serif text-xl text-navy-deep">Third parties</h2>
          {data.thirdParties.map((tp) => (
            <div key={String(tp.id)} className="mt-4 border-t border-line pt-3 text-sm first:mt-3 first:border-0 first:pt-0">
              <strong>TP {String(tp.sequence || 1)}: {String(tp.full_name)}</strong>
              <div>
                {String(tp.address_line1 || "Unknown")}, {String(tp.town || "")} {String(tp.postcode || "")} · {String(tp.telephone || "Unknown")}
              </div>
              <div className="text-slate">
                Vehicle {tp.tp_registration ? formatVehicleRegistration(String(tp.tp_registration)) : "Unknown"} {pretty(tp.tp_make)} {pretty(tp.tp_model)} {pretty(tp.tp_colour)} ·
                Tax {pretty(tp.tp_tax_status)} · MOT {pretty(tp.tp_mot_status)}
              </div>
              <div>
                Insurer {String(tp.insurer_name || "Unknown")} policy {String(tp.policy_number || "Unknown")} claim {String(tp.insurer_ref || "Unknown")}
                <br />
                Handler {String(tp.handler_name || "Unknown")} {String(tp.handler_email || "")} {String(tp.handler_tel || "")}
                <br />
                Agent {String(tp.agent_name || "Unknown")} ref {String(tp.agent_ref || "Unknown")} · Liability admitted: {pretty(tp.liability_admitted)}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {data.witnesses.length > 0 ? (
        <section className="rounded-xl border border-line bg-card p-5">
          <h2 className="font-serif text-xl text-navy-deep">Witnesses</h2>
          {data.witnesses.map((w) => (
            <p key={String(w.id)} className="mt-2 text-sm">
              {String(w.full_name)} · {String(w.telephone || "Unknown")} · {String(w.address_line1 || "")} {String(w.postcode || "")}
            </p>
          ))}
        </section>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-card p-5">
          <h2 className="font-serif text-xl text-navy-deep">Hire, recovery and storage</h2>
          <div className="mt-3 space-y-3">
            <StorageDateReview claimId={String(claim.id)} review={getStorageDateReview(String(claim.id))} returnTo={`/claims/${claim.id}`} />
            <StorageEndDateReview claimId={String(claim.id)} review={getStorageEndDateReview(String(claim.id))} returnTo={`/claims/${claim.id}`} />
            <HireEndDateReview claimId={String(claim.id)} reviews={getHireEndDateReviews(String(claim.id))} returnTo={`/claims/${claim.id}`} />
          </div>
          <AgreementParts claim={claim} hire={data.hire} recoveryJobs={data.recoveryJobs} reservations={data.reservations} />
          <ul className="mt-3 space-y-1 text-sm">
            <li>Hire status: {pretty(claim.hire_status)}</li>
            {data.hire.length === 0 ? (
              <li>Hire end: Not set</li>
            ) : (
              data.hire.map((episode) => (
                <li key={String(episode.id)}>
                  Hire end{episode.registration ? ` (${formatVehicleRegistration(String(episode.registration))})` : ""}:{" "}
                  {episode.billing_end_at ? formatUkDate(String(episode.billing_end_at)) : "Not set"}
                </li>
              ))
            )}
            <li>Recovery: {pretty(claim.recovery_status)}</li>
            <li>Storage: {pretty(claim.storage_status)}</li>
            <li>Storage started (same day as recovery): {claim.storage_started_on ? formatUkDate(String(claim.storage_started_on)) : "Not set"}</li>
            <li>Storage rate: {claim.storage_rate_pence ? formatGbp(Number(claim.storage_rate_pence)) : "Not set"} / day</li>
            <li>Storage billing end (explicit): {claim.storage_billing_end_on ? formatUkDate(String(claim.storage_billing_end_on)) : "Not set"}</li>
            <li>Qualifying payment for off-hire: {Number(claim.payment_qualifies_off_hire) ? "Yes" : "No"}</li>
            <li>Scheduled off-hire: {claim.off_hire_scheduled_on ? formatUkDate(String(claim.off_hire_scheduled_on)) : "Not set"}</li>
            <li>Repairs complete: {Number(claim.repairs_complete) ? "Yes" : "No"} · Returned to customer: {Number(claim.repaired_vehicle_returned) ? "Yes" : "No"}</li>
          </ul>
          {data.recoveryJobs.map((job) => (
            <p key={String(job.id)} className="mt-3 text-sm">
              Recovery at {String(job.location || "Unknown")} on {formatUkDate(job.recovered_at ? String(job.recovered_at) : null)}.
              Charge {formatGbp(Number(job.charge_pence))} · winch {formatGbp(Number(job.winch_pence))} · out of hours {formatGbp(Number(job.ooh_pence))} ·
              environmental {formatGbp(Number(job.environmental_pence))} · forklift {formatGbp(Number(job.forklift_pence))} · mileage {formatGbp(Number(job.mileage_pence))} ·
              manual {formatGbp(Number(job.manual_pence))}.
              Inherited: {Number(job.inherited) ? "yes" : "no"}.
              Agreement: {pretty(job.agreement_status)} via {pretty(job.agreement_channel)}.
              {job.agreement_document_id ? (
                <>
                  {" "}
                  <Link className="text-teal-dark underline" href={`/documents/${job.agreement_document_id}`}>
                    Open agreement
                  </Link>
                </>
              ) : null}
            </p>
          ))}
          {data.reservations.map((r) => (
            <p key={String(r.id)} className="mt-3 text-sm">
              Reservation {formatVehicleRegistration(String(r.registration))} ({pretty(r.kind)}) {formatUkDateTime(String(r.start_at))}–{formatUkDateTime(String(r.end_at))} · charges started: {Number(r.charges_started) ? "yes" : "no"}
            </p>
          ))}
          {data.hire.map((h) => (
            <p key={String(h.id)} className="mt-3 text-sm">
              Hire episode from {formatUkDateTime(h.started_at ? String(h.started_at) : null)} · {formatVehicleRegistration(String(h.registration))} {pretty(h.make)} {pretty(h.model)} · like-for-like {Number(h.like_for_like) ? "yes" : "no"} · credit hire {Number(h.credit_hire) ? "yes" : "no"}
              <br />
              {String(h.suitability_reason)}
            </p>
          ))}
          {data.agreements.map((a) => (
            <p key={String(a.id)} className="mt-3 text-sm">
              Agreement #{String(a.sequence)} {formatUkDate(String(a.start_on))}–{formatUkDate(String(a.planned_end_on))} · {pretty(a.signature_status)}
              {Number(a.signed) ? ` (signed ${formatUkDateTime(a.signed_at ? String(a.signed_at) : null)})` : " — not signed; will not be backdated"}
            </p>
          ))}
        </div>
        <div className="rounded-xl border border-line bg-card p-5">
          <h2 className="font-serif text-xl text-navy-deep">Financials on this file</h2>
          <p className="text-sm text-slate">Claimed {formatGbp(data.money.claimed)} · Offered {formatGbp(data.money.offered)} · Agreed {formatGbp(data.money.agreed)} · Received {formatGbp(data.money.received)}</p>
          <table className="ledger-table mt-3">
            <thead>
              <tr>
                <th>Head</th>
                <th>Claimed</th>
                <th>Offered</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {data.financials.map((line) => (
                <tr key={String(line.id)}>
                  <td>{HEAD_LABELS[String(line.head_of_loss) as HeadOfLoss] || String(line.head_of_loss)}</td>
                  <td className="tabular">{formatGbp(Number(line.claimed_pence))}</td>
                  <td className="tabular">{formatGbp(Number(line.offered_pence))}</td>
                  <td className="tabular">{formatGbp(Number(line.received_pence))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <TotalLossPanel
        claimId={String(claim.id)}
        totalLoss={Number(claim.total_loss) === 1}
        returnTo={`/claims/${claim.id}`}
        error={tlError}
      />

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-card p-5">
          <h2 className="font-serif text-xl text-navy-deep">Notes</h2>
          <ValidatedForm action={actionAddNote} className="mt-3 space-y-2">
            <input type="hidden" name="claimId" value={String(claim.id)} />
            <input type="hidden" name="authorId" value={String(claim.handler_id || "staff-sian")} />
            <textarea name="body" required rows={3} className={field} placeholder="Add a file note" />
            <button className="rounded-md bg-navy px-3 py-2 text-sm text-white" type="submit">
              Add note
            </button>
          </ValidatedForm>
          <ul className="mt-4 space-y-3">
            {data.notes.map((n) => (
              <li key={n.id} className="border-t border-line pt-3 text-sm">
                <div className="text-xs text-slate">
                  {n.author_name} · {formatUkDateTime(n.created_at)}
                </div>
                {n.body}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-line bg-card p-5">
          <h2 className="font-serif text-xl text-navy-deep">Tasks</h2>
          <ValidatedForm action={actionAddTask} className="mt-3 grid gap-2">
            <input type="hidden" name="claimId" value={String(claim.id)} />
            <input name="title" required placeholder="Task title" className={field} />
            <div className="grid grid-cols-2 gap-2">
              <select name="handlerId" className={field} defaultValue={String(claim.handler_id || "staff-sian")}>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <input name="dueAt" type="datetime-local" className={field} />
            </div>
            <input type="hidden" name="type" value="general" />
            <button className="rounded-md bg-navy px-3 py-2 text-sm text-white" type="submit">
              Add task
            </button>
          </ValidatedForm>
          <ul className="mt-4 space-y-2">
            {data.tasks.map((t) => (
              <li key={String(t.id)} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <strong>{String(t.title)}</strong>
                  <div className="text-xs text-slate">
                    {pretty(t.handler_name)} · {formatUkDateTime(t.due_at ? String(t.due_at) : null)} · {pretty(t.status)}
                  </div>
                </div>
                {t.status === "open" ? (
                  <form action={actionCompleteTask}>
                    <input type="hidden" name="taskId" value={String(t.id)} />
                    <button className="text-xs text-teal-dark underline" type="submit">
                      Done
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <Box title="Correspondence">
          {data.correspondence.map((c) => (
            <p key={String(c.id)} className="text-sm">
              {Number(c.unread) ? "Unread · " : ""}
              {pretty(c.direction)} {pretty(c.channel)}: {String(c.subject)} ({pretty(c.sent_status)})
            </p>
          ))}
        </Box>
        <Box title="Documents">
          {data.documents.map((d) => (
            <p key={String(d.id)} className="text-sm">
              {d.body_html ? (
                <Link className="text-teal-dark underline" href={`/documents/${d.id}`}>
                  {String(d.title)} v{String(d.version)}
                </Link>
              ) : (
                <>
                  {String(d.title)} v{String(d.version)}
                </>
              )}{" "}
              {Number(d.signed) ? "signed" : "unsigned"} {Number(d.simulated) ? "(simulated file)" : ""}
            </p>
          ))}
        </Box>
        <Box title="Automations / litigation / MID">
          {data.automations.map((a) => (
            <p key={String(a.id)} className="text-sm">
              {pretty(a.track)} · {pretty(a.status)} · {String(a.reason)} {Number(a.paused) ? "(paused)" : ""}
            </p>
          ))}
          {data.litigation.map((l) => (
            <p key={String(l.id)} className="text-sm">
              {pretty(l.stage)} deadline {formatUkDate(l.deadline_on ? String(l.deadline_on) : null)}. Issue approved: {Number(l.approved_to_issue) ? "yes" : "no"}.
              <span className="block text-xs text-slate">{String(l.deadline_source)}</span>
            </p>
          ))}
          {data.mid.map((m) => (
            <p key={String(m.id)} className="text-sm">
              MID (manual): {formatVehicleRegistration(String(m.registration))} → {pretty(m.insurer)} on {formatUkDate(String(m.lookup_on))} by {String(m.checker_name)} ({pretty(m.source)})
            </p>
          ))}
        </Box>
      </section>
    </div>
  );
}

function AgreementParts({
  claim,
  hire,
  recoveryJobs,
  reservations,
}: {
  claim: Record<string, string | number | null>;
  hire: Array<Record<string, string | number | null>>;
  recoveryJobs: Array<Record<string, string | number | null>>;
  reservations: Array<Record<string, string | number | null>>;
}) {
  const hireRow = hire[0];
  const recovered = recoveryJobs.find((job) => String(job.recovered_at || "").trim());
  const parts = describeHireAgreementParts({
    hireAllocated: hire.length > 0,
    hireDescription: hireRow
      ? [hireRow.make, hireRow.model, hireRow.registration ? formatVehicleRegistration(String(hireRow.registration)) : ""]
          .map((part) => String(part || "").trim())
          .filter(Boolean)
          .join(" ")
      : "",
    recoveryStatus: claim.recovery_status ? String(claim.recovery_status) : null,
    storageStatus: claim.storage_status ? String(claim.storage_status) : null,
    storageStartedOn: claim.storage_started_on ? String(claim.storage_started_on) : null,
    recoveryRecoveredAt: recovered?.recovered_at ? String(recovered.recovered_at) : null,
    hasReservation: reservations.some((row) => ["reserved", "active"].includes(String(row.status || "").toLowerCase())),
  });
  return (
    <div className="mt-3 rounded-md border border-line bg-white px-3 py-3 text-sm">
      <p className="font-medium text-navy-deep">Hire Agreement pages</p>
      <ul className="mt-2 space-y-1">
        <li>{parts.hire.reason}</li>
        <li>{parts.storageRecovery.reason}</li>
        <li>{parts.termsAndCancel.reason}</li>
      </ul>
      <p className="mt-2 text-slate">The next agreement from this file will be {parts.pageCount} pages.</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <p className="text-xs uppercase tracking-[0.12em] text-slate">{label}</p>
      <p className="mt-1 text-sm">{value}</p>
    </div>
  );
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <h2 className="font-serif text-xl text-navy-deep">{title}</h2>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}
