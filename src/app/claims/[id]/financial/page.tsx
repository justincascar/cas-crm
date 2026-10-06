import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ClaimTable";
import { isAdministrator } from "@/lib/auth/roles";
import { requireStaff } from "@/lib/auth/session";
import { listClaimFileDocuments } from "@/lib/db/claim-documents";
import {
  checklistStatus,
  impecuniosityApproved,
  impecuniosityGate,
  listDisclosureConcerns,
  listFinancialCircumstances,
  listImpecuniosityAccounts,
  listMitigationStatements,
} from "@/lib/db/impecuniosity";
import { getClaim } from "@/lib/db/queries";
import { formatUkDate, formatUkDateTime } from "@/lib/dates";
import {
  ABILITY_ANSWERS,
  ABILITY_TO_PAY_QUESTION,
  ABILITY_TO_PAY_REVIEW,
  CONCURRENT_EDIT_NOTICE,
  EMPLOYMENT_STATUSES,
  EVIDENCE_KINDS,
  MITIGATION_QUESTIONNAIRE,
  NO_CLIENT_PORTAL_NOTICE,
  OPERATIONAL_RECORD_NOTICE,
  abilityAnswerLabel,
  checklistStatusLabel,
  employmentLabel,
  evidenceKindLabel,
} from "@/lib/domain/impecuniosity";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export default async function FinancialCircumstancesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  const query = await searchParams;
  const data = getClaim(id);
  if (!data) notFound();
  const circumstances = listFinancialCircumstances(id);
  const accounts = listImpecuniosityAccounts(id);
  const concerns = listDisclosureConcerns(id);
  const statements = listMitigationStatements(id);
  const status = checklistStatus(id);
  const approved = impecuniosityApproved(id);
  const gate = impecuniosityGate(id);
  const evidence = listClaimFileDocuments(id).filter((item) => item.documentType === "impecuniosity_evidence");
  const administrator = isAdministrator(staff.role);
  const latestCircumstances = circumstances.at(-1);
  const q = MITIGATION_QUESTIONNAIRE;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financial circumstances"
        subtitle="Need for a vehicle and ability to pay are recorded separately. Staff enter what the client or a handler actually provides. Nothing here is inferred."
      />
      <p className="rounded-md border border-line bg-card px-4 py-3 text-sm">{OPERATIONAL_RECORD_NOTICE}</p>
      <p className="text-sm text-slate">{NO_CLIENT_PORTAL_NOTICE}</p>
      <p className="text-sm text-slate">{CONCURRENT_EDIT_NOTICE}</p>
      {query.error ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{query.error}</p>
      ) : null}
      {query.saved ? (
        <p className="rounded-md border border-ok/40 bg-[#eef6ef] px-4 py-3 text-sm">Saved on this file. It stays after you sign out.</p>
      ) : null}

      <section className={`rounded-xl border p-5 ${gate.canRely ? "border-ok/40 bg-[#eef6ef]" : "border-warn/40 bg-[#fff6e8]"}`}>
        <h2 className="font-serif text-xl text-navy-deep">Relying on impecuniosity</h2>
        <p className="mt-2 text-sm">
          Checklist: <strong>{checklistStatusLabel(status)}</strong>. Approval:{" "}
          <strong>{approved ? "Approved to rely on impecuniosity" : "Not approved"}</strong>.
        </p>
        <p className="mt-2 text-sm">
          {gate.canRely
            ? "Both are in place, so a document that relies on impecuniosity can be produced. That still does not mean the charges can be recovered."
            : gate.generationBlock}
        </p>
      </section>

      <section className="space-y-4 rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">What the client said about their means</h2>
        <p className="text-sm text-slate">
          A change is a new dated entry. The earlier entry stays. This does not change the checklist.
        </p>
        {circumstances.length === 0 ? <p className="text-sm">Nothing recorded yet.</p> : null}
        <ul className="space-y-3">
          {[...circumstances].reverse().map((row, index) => (
            <li key={row.id} className="rounded-lg border border-line px-3 py-3 text-sm">
              <p className="font-semibold">
                {circumstances.length - index} · {formatUkDateTime(row.recorded_at)}
                {row.recorded_by_name ? ` · ${row.recorded_by_name}` : ""}
              </p>
              {row.correction_reason ? <p>Reason for this entry: {row.correction_reason}</p> : null}
              <p>Employment: {employmentLabel(row.employment_status)}</p>
              {row.employment_words ? <p>In the client&apos;s words: {row.employment_words}</p> : null}
              <p>Approximate income, as stated: {row.income_as_stated || "Not stated"}</p>
              <p>Benefits, if any, as stated: {row.benefits_as_stated || "None stated"}</p>
              <p>Ability to pay: {abilityAnswerLabel(row.ability_to_pay)}</p>
              {row.ability_to_pay_words ? <p>Client&apos;s words: {row.ability_to_pay_words}</p> : null}
              <p>No bank account or cash income: {row.no_bank_explanation || "Not stated"}</p>
              <p className="text-slate">Question asked: {row.question_wording}</p>
            </li>
          ))}
        </ul>
        <form method="post" action={`/claims/${id}/financial/save`} className="grid gap-3">
          <input type="hidden" name="intent" value="circumstances" />
          {latestCircumstances ? (
            <label className="text-sm">
              Why this replaces the earlier record
              <textarea name="correctionReason" required rows={2} className={field} />
            </label>
          ) : null}
          <label className="text-sm">
            Employment status, as the client described it
            <select name="employmentStatus" className={field} defaultValue="not_stated">
              {EMPLOYMENT_STATUSES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Employment, in the client&apos;s words
            <input name="employmentWords" className={field} />
          </label>
          <label className="text-sm">
            Approximate income, in the client&apos;s words
            <input name="incomeAsStated" className={field} placeholder="For example, what they said they take home" />
          </label>
          <label className="text-sm">
            Benefits, if any, in the client&apos;s words
            <input name="benefitsAsStated" className={field} />
          </label>
          <fieldset className="space-y-2 rounded-lg border border-warn/40 bg-[#fff6e8] p-3">
            <legend className="px-1 text-sm font-semibold">Ability to pay — the client&apos;s own answer</legend>
            <p className="text-sm">{ABILITY_TO_PAY_QUESTION}</p>
            <p className="text-xs text-slate">{ABILITY_TO_PAY_REVIEW}</p>
            {ABILITY_ANSWERS.map((item) => (
              <label key={item.value} className="flex gap-2 text-sm">
                <input type="radio" name="abilityToPay" value={item.value} required defaultChecked={item.value === "not_answered"} />
                {item.label}
              </label>
            ))}
            <label className="block text-sm">
              Anything else the client said
              <textarea name="abilityToPayWords" rows={2} className={field} />
            </label>
          </fieldset>
          <label className="text-sm">
            If the client has no bank account, or is paid in cash, record their explanation. Leave blank if it does not apply. Saving is not blocked.
            <textarea name="noBankExplanation" rows={2} className={field} />
          </label>
          <button className="w-fit rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white" type="submit">
            Save this entry
          </button>
        </form>
      </section>

      <section className="space-y-4 rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Evidence checklist</h2>
        <p className="text-sm text-slate">
          Status is {checklistStatusLabel(status)}. Uploading a file, or listing an account, does not change it. Only a handler can mark it Complete, and only by using that button.
          Partial stays Partial until a handler changes it.
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["not_started", "Set to Not started"],
              ["requested", "Set to Requested"],
              ["partial", "Set to Partial"],
            ] as const
          ).map(([value, label]) => (
            <form key={value} method="post" action={`/claims/${id}/financial/save`}>
              <input type="hidden" name="intent" value="checklist" />
              <input type="hidden" name="status" value={value} />
              <button className="rounded-md border border-line bg-white px-3 py-2 text-sm" type="submit">
                {label}
              </button>
            </form>
          ))}
          <form method="post" action={`/claims/${id}/financial/save`}>
            <input type="hidden" name="intent" value="checklist" />
            <input type="hidden" name="status" value="complete" />
            <button className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white" type="submit">
              Mark checklist Complete
            </button>
          </form>
        </div>
        <h3 className="font-serif text-lg text-navy-deep">Accounts and papers, each listed separately</h3>
        {accounts.length === 0 ? <p className="text-sm">No account, wage slips or benefit letter listed yet.</p> : null}
        <ul className="space-y-2 text-sm">
          {accounts.map((row) => (
            <li key={row.id} className="rounded-lg border border-line px-3 py-2">
              <span className="font-semibold">{evidenceKindLabel(row.kind)}</span> — {row.label}
              {row.notes ? ` — ${row.notes}` : ""} · {formatUkDateTime(row.recorded_at)}
              {row.recorded_by_name ? ` · ${row.recorded_by_name}` : ""}
            </li>
          ))}
        </ul>
        <form method="post" action={`/claims/${id}/financial/save`} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="intent" value="account" />
          <label className="text-sm">
            Name
            <input name="label" required className={field} placeholder="For example, Barclays current" />
          </label>
          <label className="text-sm">
            Kind
            <select name="kind" className={field} defaultValue="bank_account">
              {EVIDENCE_KINDS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm sm:col-span-2">
            Note
            <input name="notes" className={field} />
          </label>
          <button className="w-fit rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white" type="submit">
            Add to the list
          </button>
        </form>
        <h3 className="font-serif text-lg text-navy-deep">Stored impecuniosity evidence</h3>
        <p className="text-sm text-slate">
          Files use the same upload as V5Cs and insurance certificates, tagged Impecuniosity evidence. Storing one does not mark the checklist Complete.
        </p>
        {evidence.length === 0 ? <p className="text-sm">No file of that type stored yet.</p> : null}
        <ul className="space-y-1 text-sm">
          {evidence.map((doc) => (
            <li key={doc.id}>
              <Link className="text-teal-dark underline" href={`/documents/${doc.id}`}>
                {doc.originalFilename}
              </Link>{" "}
              · {formatUkDateTime(doc.createdAt)}
            </li>
          ))}
        </ul>
        <form method="post" action={`/claims/${id}/documents/upload`} encType="multipart/form-data" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="documentType" value="impecuniosity_evidence" />
          <input type="hidden" name="returnTo" value={`/claims/${id}/financial`} />
          <label className="text-sm">
            PDF or photograph
            <input name="document" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp,image/gif,.pdf,.jpg,.jpeg,.png,.webp,.gif" className={field} />
          </label>
          <button className="rounded-md border border-line bg-white px-3 py-2 text-sm" type="submit">
            Store on this file
          </button>
        </form>
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Disclosure concerns</h2>
        <p className="text-sm text-slate">
          A handler&apos;s note if something looks off, such as a gap in dates, a missing account, or an unexplained transfer. The system does not write this. It is staff judgement, not a decision.
        </p>
        {concerns.length === 0 ? <p className="text-sm">No concern recorded.</p> : null}
        <ul className="space-y-2 text-sm">
          {concerns.map((row) => (
            <li key={row.id} className="rounded-lg border border-line px-3 py-2">
              {row.body}
              <span className="block text-slate">
                {formatUkDateTime(row.recorded_at)}
                {row.recorded_by_name ? ` · ${row.recorded_by_name}` : ""}
              </span>
            </li>
          ))}
        </ul>
        <form method="post" action={`/claims/${id}/financial/save`} className="grid gap-3">
          <input type="hidden" name="intent" value="concern" />
          <label className="text-sm">
            Concern
            <textarea name="body" required rows={3} className={field} />
          </label>
          <button className="w-fit rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white" type="submit">
            Add concern
          </button>
        </form>
      </section>

      <section className="space-y-4 rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">{q.heading}</h2>
        <p className="text-sm text-slate">
          {q.audience}. The questions are the Hire Pack questionnaire. A correction is a new dated entry with a reason. The earlier statement is not edited. There is no separate question for how long; record that in the client&apos;s own answer to why they need a vehicle.
        </p>
        {statements.length === 0 ? <p className="text-sm">No mitigation statement yet.</p> : null}
        <ul className="space-y-3">
          {statements.map((row, index) => (
            <li key={row.id} className="rounded-lg border border-line px-3 py-3 text-sm">
              <p className="font-semibold">
                Version {index + 1}
                {row.statement_on ? ` · statement date ${formatUkDate(row.statement_on)}` : ""} · recorded {formatUkDateTime(row.recorded_at)}
                {row.recorded_by_name ? ` · ${row.recorded_by_name}` : ""}
              </p>
              {row.correction_reason ? <p>Reason for this entry: {row.correction_reason}</p> : null}
              <p>{q.preamble}</p>
              <p>{row.offer_position === "no_offer" ? "☑" : "☐"} {q.noOffer}</p>
              <p>OR</p>
              <p>
                {row.offer_position === "declined" ? "☑" : "☐"} {q.declinedBecause}
                {row.declined_offer_reason ? `: ${row.declined_offer_reason}` : ""}
              </p>
              <p>{row.understands_personal_liability ? "☑" : "☐"} {q.personalLiability}</p>
              <p>
                {q.needBecause}: {row.need_reason || "Not stated"}
              </p>
              <p>{row.own_vehicle_unusable ? "☑" : "☐"} {q.ownVehicle}</p>
              <p>{row.no_other_vehicle ? "☑" : "☐"} {q.noOtherVehicle}</p>
              <p>{q.statementOfTruth}</p>
            </li>
          ))}
        </ul>
        <form method="post" action={`/claims/${id}/financial/save`} className="grid gap-3">
          <input type="hidden" name="intent" value="mitigation" />
          <p className="text-sm">{q.preamble}</p>
          {statements.length > 0 ? (
            <label className="text-sm">
              What was wrong with the earlier statement
              <textarea name="correctionReason" required rows={2} className={field} />
            </label>
          ) : null}
          <label className="text-sm">
            Date the client gave these answers
            <input name="statementOn" type="date" className={field} />
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Offer of a replacement vehicle — one or the other</legend>
            <label className="flex gap-2 text-sm">
              <input type="radio" name="offerPosition" value="no_offer" required />
              {q.noOffer}
            </label>
            <label className="flex gap-2 text-sm">
              <input type="radio" name="offerPosition" value="declined" />
              {q.declinedBecause}
            </label>
            <label className="flex gap-2 text-sm">
              <input type="radio" name="offerPosition" value="not_answered" />
              Not answered
            </label>
            <label className="block text-sm">
              If an offer was not accepted, why — in the client&apos;s words
              <textarea name="declinedOfferReason" rows={2} className={field} />
            </label>
          </fieldset>
          <label className="flex gap-2 text-sm">
            <input type="checkbox" name="understandsPersonalLiability" value="1" />
            {q.personalLiability}
          </label>
          <label className="text-sm">
            {q.needBecause}
            <textarea name="needReason" rows={3} className={field} placeholder="The client's own words, including how long they say they need a vehicle" />
          </label>
          <label className="flex gap-2 text-sm">
            <input type="checkbox" name="ownVehicleUnusable" value="1" />
            {q.ownVehicle}
          </label>
          <label className="flex gap-2 text-sm">
            <input type="checkbox" name="noOtherVehicle" value="1" />
            {q.noOtherVehicle}
          </label>
          <p className="text-sm">{q.statementOfTruth} A signature is not added here.</p>
          <button className="w-fit rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white" type="submit">
            Save statement
          </button>
        </form>
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Approved to rely on impecuniosity</h2>
        <p className="text-sm text-slate">
          Separate from the checklist. Only an administrator can set it. That is the sign-off for using impecuniosity in a document. Staff can record the evidence without this.
        </p>
        <p className="text-sm font-semibold">{approved ? "Approved." : "Not approved."}</p>
        {administrator ? (
          <form method="post" action={`/claims/${id}/financial/save`}>
            <input type="hidden" name="intent" value="approval" />
            <input type="hidden" name="approved" value={approved ? "no" : "yes"} />
            <button className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white" type="submit">
              {approved ? "Withdraw approval" : "Approve relying on impecuniosity"}
            </button>
          </form>
        ) : (
          <p className="text-sm">You can record the evidence. You cannot set this approval.</p>
        )}
      </section>
    </div>
  );
}
