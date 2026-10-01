import { OpenPreparedMailto } from "@/components/claims/OpenPreparedMailto";
import { CAS_CLAIMS_MAILBOX } from "@/lib/constants";
import { formatUkDate, formatUkDateTime, nowUtcIso } from "@/lib/dates";
import { buildMailtoHref } from "@/lib/email/mailto";
import { getPreparedFollowUpEmail, listFollowUpChases, totalLossPaymentChaseTemplateKey } from "@/lib/db/follow-up-chases";
import { TOTAL_LOSS_PAYMENT_CHASE_KIND } from "@/lib/domain/follow-up-chases";
import { getInsurerPaymentPromisedAt, getPreparedTotalLossNotice, getTotalLossReport, getVehicleDamageMoney } from "@/lib/db/total-loss";
import {
  disposalApplies,
  figuresIncomplete,
  salvageRequestMismatch,
  salvageSaleVariance,
  totalLossSuggestion,
} from "@/lib/domain/total-loss";
import { formatGbp } from "@/lib/money";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

function poundsInput(pence: number | null) {
  if (pence == null) return "";
  return (pence / 100).toFixed(2);
}

function moneyLabel(pence: number | null) {
  if (pence == null) return "Not set";
  return formatGbp(pence);
}

export function TotalLossPanel({
  claimId,
  totalLoss,
  returnTo,
  error,
  openMailId,
}: {
  claimId: string;
  totalLoss: boolean;
  returnTo: string;
  error?: string;
  openMailId?: string;
}) {
  if (!totalLoss) return null;
  const report = getTotalLossReport(claimId);
  const damage = getVehicleDamageMoney(claimId);
  const suggestion = totalLossSuggestion(report);
  const incomplete = figuresIncomplete(report);
  const showDisposal = disposalApplies(report.interest);
  const variance = report.disposal === "sold" ? salvageSaleVariance(report.salvagePence, report.saleProceedsPence) : null;
  const mismatch = salvageRequestMismatch(report.casRequest, report.interest);
  const prepared = getPreparedTotalLossNotice(claimId);
  const promisedAt = getInsurerPaymentPromisedAt(claimId);
  const paymentChase = listFollowUpChases(nowUtcIso(), claimId).find((row) => row.kind === TOTAL_LOSS_PAYMENT_CHASE_KIND);
  const preparedChase = getPreparedFollowUpEmail(claimId, totalLossPaymentChaseTemplateKey());
  const chaseMailto =
    preparedChase?.to_address && preparedChase.body
      ? buildMailtoHref(preparedChase.to_address, preparedChase.subject || "Total loss payment", preparedChase.body)
      : null;

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <h2 className="font-serif text-xl text-navy-deep">Total loss — engineer&apos;s report</h2>
      <p className="mt-1 text-sm text-slate">
        Pre-accident value and salvage value are typed from the engineer&apos;s report. Leave a box empty until the report gives the figure.
        An empty box is not zero. Hire and storage figures are not changed here. Nothing is marked agreed or paid until you confirm it.
      </p>
      {error ? <p className="mt-3 rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p> : null}
      {incomplete ? (
        <p className="mt-3 rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm">
          Both the pre-accident value and the salvage value are needed. The missing figure has not been treated as zero, and no insurer payment is suggested yet.
        </p>
      ) : null}

      <form method="post" action={`/claims/${claimId}/total-loss`} className="mt-4 space-y-4">
        <input type="hidden" name="returnTo" value={returnTo} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Pre-accident value (£)
            <input name="pav" inputMode="decimal" className={field} defaultValue={poundsInput(report.pavPence)} />
          </label>
          <label className="text-sm">
            Salvage value from the engineer (£)
            <input name="salvage" inputMode="decimal" className={field} defaultValue={poundsInput(report.salvagePence)} />
          </label>
        </div>

        <fieldset className="text-sm">
          <legend className="font-semibold">What is CAS asking the insurer for?</legend>
          <p className="mt-1 text-slate">This is CAS&apos;s request. It is not the insurer&apos;s answer, and it does not change storage or recovery.</p>
          <label className="mt-2 flex items-center gap-2">
            <input type="radio" name="casRequest" value="" defaultChecked={report.casRequest == null} />
            Not recorded yet
          </label>
          <label className="mt-2 flex items-center gap-2">
            <input type="radio" name="casRequest" value="full_pav" defaultChecked={report.casRequest === "full_pav"} />
            Full pre-accident value — insurer to collect the salvage
          </label>
          <label className="mt-2 flex items-center gap-2">
            <input type="radio" name="casRequest" value="net_cas" defaultChecked={report.casRequest === "net_cas"} />
            Net figure — CAS retains/disposes of the salvage
          </label>
          <p className="mt-3 text-slate">
            Prepared for the handler to send from their own email client. Not sent automatically from {CAS_CLAIMS_MAILBOX}.
          </p>
          <button name="intent" value="prepare_email" className="mt-3 min-h-11 rounded-md bg-teal px-3 py-2 text-sm font-semibold text-white" type="submit">
            Prepare notification email
          </button>
        </fieldset>

        <fieldset className="text-sm">
          <legend className="font-semibold">Has the insurer taken an interest in the salvage?</legend>
          <label className="mt-2 flex items-center gap-2">
            <input type="radio" name="interest" value="" defaultChecked={report.interest == null} />
            Not recorded yet
          </label>
          <label className="mt-2 flex items-center gap-2">
            <input type="radio" name="interest" value="no_interest" defaultChecked={report.interest === "no_interest"} />
            No — CAS is disposing of the salvage
          </label>
          <label className="mt-2 flex items-center gap-2">
            <input type="radio" name="interest" value="takes_interest" defaultChecked={report.interest === "takes_interest"} />
            Yes — the insurer is taking the salvage
          </label>
        </fieldset>

        {mismatch ? (
          <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm">
            {mismatch}. Storage and recovery figures have not been changed.
          </p>
        ) : null}

        {report.interest === "takes_interest" ? (
          <p className="text-sm">
            The insurer is taking the salvage
            {report.pavPence != null ? ` and is expected to pay the full pre-accident value of ${formatGbp(report.pavPence)}` : ""}. Salvage
            disposal is not recorded here, because CAS is not disposing of it. That expected payment is not the agreed amount until you enter it
            below and confirm it.
          </p>
        ) : null}

        {suggestion.kind === "suggestion" ? (
          <div className="rounded-md border border-line bg-white px-4 py-3 text-sm">
            <p className="font-semibold">Suggested insurer payment: {formatGbp(suggestion.pence)}</p>
            <p className="mt-1">
              Pre-accident value minus the engineer&apos;s salvage value. This is a suggestion only. It is not the agreed amount, and it is not
              marked paid, until you press the button.
            </p>
            {suggestion.pence >= 0 ? (
              <button name="intent" value="confirm_suggestion" className="mt-3 min-h-11 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white" type="submit">
                Use this suggestion as the agreed amount
              </button>
            ) : (
              <p className="mt-2">Salvage value is higher than the pre-accident value. The suggestion has not been applied. Check the engineer&apos;s figures.</p>
            )}
          </div>
        ) : null}

        <label className="block text-sm">
          Insurer&apos;s own offer (£), if it differs from the engineer
          <input name="insurerOffer" inputMode="decimal" className={field} placeholder="Leave blank to keep the offer already on the file" />
          <span className="mt-1 block text-slate">
            Offer already recorded: {moneyLabel(report.insurerOfferedPence != null ? report.insurerOfferedPence : damage.offeredPence > 0 ? damage.offeredPence : null)}.
            Saving an offer does not change the agreed or paid amount.
          </span>
        </label>

        <div className="rounded-md border border-line px-4 py-3 text-sm">
          <p>
            Agreed vehicle damage: {damage.id ? formatGbp(damage.agreedPence) : "Not set"}. Paid: {damage.id ? formatGbp(damage.receivedPence) : "Not set"}.
            Paid is not changed from this screen.
          </p>
          <label className="mt-2 block">
            A different agreed amount (£)
            <input name="agreed" inputMode="decimal" className={field} placeholder="Leave blank unless you are confirming a different figure" />
          </label>
          <button name="intent" value="confirm_agreed" className="mt-3 min-h-11 rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold" type="submit">
            Save this as the agreed amount
          </button>
        </div>

        {showDisposal ? (
          <fieldset className="space-y-3 text-sm">
            <legend className="font-semibold">What happened to the salvage?</legend>
            <p>This can be recorded before the insurer&apos;s payment is agreed. It does not change the agreed or paid amount.</p>
            <label className="block">
              Outcome
              <select name="disposal" className={field} defaultValue={report.disposal || ""}>
                <option value="">Not recorded yet</option>
                <option value="sold">Sold to a third party</option>
                <option value="returned">Returned to the customer</option>
                <option value="bought_by_cas">Bought by CAS</option>
              </select>
            </label>
            <label className="block">
              Actual sale proceeds (£), if sold to a third party
              <input name="saleProceeds" inputMode="decimal" className={field} defaultValue={poundsInput(report.saleProceedsPence)} />
            </label>
            <label className="block">
              Date returned to the customer, if returned
              <input name="returnedOn" type="date" className={field} defaultValue={report.returnedOn || ""} />
            </label>
            <label className="block">
              Amount charged to the customer (£), if any
              <input name="customerCharge" inputMode="decimal" className={field} defaultValue={poundsInput(report.customerChargePence)} placeholder="Leave blank if none" />
              <span className="mt-1 block text-slate">Leave this blank if no charge applies. A blank is not a fee of zero.</span>
            </label>
            <label className="block">
              CAS purchase figure (£), if CAS bought the salvage
              <input name="casPurchase" inputMode="decimal" className={field} defaultValue={poundsInput(report.casPurchasePence)} />
            </label>
            {variance != null && variance !== 0 ? (
              <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3">
                Sale proceeds are {formatGbp(report.saleProceedsPence)}. The engineer&apos;s salvage value is {formatGbp(report.salvagePence)}. The
                difference is {formatGbp(Math.abs(variance))}
                {variance < 0 ? " less than the engineer's figure" : " more than the engineer's figure"}. This is flagged for review. It has not been
                added to the vehicle-damage agreed or paid amounts.
              </p>
            ) : null}
            {report.disposal === "returned" && report.returnedOn ? <p>Returned to the customer on {formatUkDate(report.returnedOn)}.</p> : null}
            {report.disposal === "returned" && !report.returnedOn ? <p>The return date has not been entered yet.</p> : null}
            {report.disposal === "bought_by_cas" && report.casPurchasePence == null ? <p>CAS&apos;s purchase figure has not been entered yet.</p> : null}
            {report.disposal === "sold" && report.saleProceedsPence == null ? <p>The sale proceeds have not been entered yet.</p> : null}
          </fieldset>
        ) : null}

        <button name="intent" value="save" className="min-h-11 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white" type="submit">
          Save these figures
        </button>
      </form>

      {prepared?.mailto ? (
        <div className="mt-4 rounded-md border border-line bg-white px-4 py-3 text-sm">
          <p>
            A notification email was prepared {formatUkDateTime(prepared.createdAt)} for {prepared.toAddress}. It has not been sent from{" "}
            {CAS_CLAIMS_MAILBOX}.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <OpenPreparedMailto href={prepared.mailto} autoOpen={openMailId === prepared.id} />
            <form method="post" action={`/claims/${claimId}/total-loss`}>
              <input type="hidden" name="intent" value="mark_sent" />
              <input type="hidden" name="correspondenceId" value={prepared.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button className="min-h-11 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white" type="submit">
                Mark as sent
              </button>
            </form>
          </div>
        </div>
      ) : null}

      <div className="mt-6 border-t border-line pt-4 text-sm">
        <h3 className="font-semibold text-navy">Insurer payment</h3>
        <p className="mt-1 text-slate">
          Confirmation that the insurer is sending the money is separate from the money actually arriving. Neither is filled in for you.
          A chase is prepared here for you to send. Nothing is sent automatically.
        </p>
        <p className="mt-2">
          Insurer confirmed they are sending payment: {promisedAt ? formatUkDateTime(promisedAt) : "Not confirmed"}. Paid:{" "}
          {damage.id ? formatGbp(damage.receivedPence) : "Not set"}.
        </p>
        {paymentChase?.due ? <p className="mt-2 font-semibold">{paymentChase.label}</p> : null}
        {paymentChase && !paymentChase.due && !paymentChase.outcomeOnFile ? (
          <p className="mt-2 text-slate">{paymentChase.reason} Not due yet.</p>
        ) : null}
        {paymentChase?.outcomeOnFile ? <p className="mt-2">Payment is on file. The chase is cleared.</p> : null}
        <div className="mt-3 flex flex-col gap-3">
          {!promisedAt && damage.receivedPence <= 0 ? (
            <form method="post" action={`/claims/${claimId}/total-loss`}>
              <input type="hidden" name="intent" value="promise_payment" />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button className="min-h-11 rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold" type="submit">
                Insurer has confirmed they are sending payment
              </button>
            </form>
          ) : null}
          {damage.receivedPence <= 0 ? (
            <form method="post" action={`/claims/${claimId}/total-loss`} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="intent" value="record_payment" />
              <input type="hidden" name="returnTo" value={returnTo} />
              <label>
                Amount that has arrived (£)
                <input name="received" inputMode="decimal" className={field} />
              </label>
              <button className="min-h-11 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white" type="submit">
                Record payment received
              </button>
            </form>
          ) : null}
          {paymentChase?.due ? (
            <form method="post" action={`/claims/${claimId}/total-loss`}>
              <input type="hidden" name="intent" value="prepare_payment_chase" />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button className="min-h-11 rounded-md bg-teal px-3 py-2 text-sm font-semibold text-white" type="submit">
                Prepare payment chase email
              </button>
            </form>
          ) : null}
          {chaseMailto && preparedChase ? (
            <div className="rounded-md border border-line bg-white px-4 py-3">
              <p>
                A payment chase was prepared {formatUkDateTime(preparedChase.created_at)} for {preparedChase.to_address}. It has not been sent from{" "}
                {CAS_CLAIMS_MAILBOX}.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <OpenPreparedMailto href={chaseMailto} autoOpen={openMailId === preparedChase.id} />
                <form method="post" action={`/claims/${claimId}/total-loss`}>
                  <input type="hidden" name="intent" value="mark_payment_chase_sent" />
                  <input type="hidden" name="correspondenceId" value={preparedChase.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button className="min-h-11 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white" type="submit">
                    Mark chase as sent
                  </button>
                </form>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
