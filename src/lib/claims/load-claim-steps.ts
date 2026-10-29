import {
  deriveClaimSteps,
  type AudatexFacts,
  type ClaimPaymentLineInput,
  type ClaimStepChase,
  type ClaimStepView,
} from "../domain/claim-steps";
import { listChasesForClaim } from "../db/chase";
import { hireChargeForClaim } from "../db/hire-charge";
import { hireAgreementPrehireBlock } from "../db/prehire-checks";
import { get } from "../db/connection";
import { storageAuthorisationEndForClaim } from "../db/storage-authorisation-end";
import { totalLossOffHireForClaim } from "../db/total-loss-off-hire";
import { proposedStorageEndSentence } from "../domain/storage-authorisation-end";
import { claimOutstandingSummary, getClaim } from "../db/queries";

const REQUEST_EVENTS: Record<ClaimPaymentLineInput["key"], string[]> = {
  repairs: ["repair_payment_request_sent", "settlement_payment_request_sent"],
  recovery: ["recovery_payment_request_sent"],
  storage: ["storage_payment_request_sent"],
  hire: ["hire_payment_request_sent"],
};

export function loadClaimSteps(claimId: string): ClaimStepView[] | null {
  const data = getClaim(claimId);
  if (!data) return null;
  const { claim } = data;
  const id = String(claim.id);
  const events = data.events.map((event) => ({
    event_type: String(event.event_type),
    occurred_at: String(event.occurred_at),
    details: event.details ? String(event.details) : null,
  }));
  const eventTypes = new Set(events.map((event) => event.event_type));
  const chaseRows = listChasesForClaim(id);
  const chases: ClaimStepChase[] = chaseRows.map((chase) => ({
    kind: String(chase.kind),
    active: chase.active,
    due: chase.due,
    outcomeOnFile: chase.outcomeOnFile,
    intervalDays: chase.intervalDays,
    dueAt: chase.dueAt,
    handlerState: chase.handlerState,
  }));
  const money = claimOutstandingSummary(id);
  const byHead = new Map(money.heads.map((row) => [row.head, row]));
  const hireView = hireChargeForClaim(id);
  const totalLoss = Number(claim.total_loss) === 1 || Number(claim.later_declared_total_loss) === 1;
  const fault = String(claim.claim_type || "") === "fault";
  const insurer = data.thirdParties.find((party) => String(party.insurer_name || "").trim());
  const insurerName = fault
    ? String(claim.own_insurer_name || "")
    : insurer
      ? String(insurer.insurer_name || "")
      : "";
  const signedRate = [...hireView.agreements].reverse().find((row) => row.signed && row.ratePence && row.ratePence > 0)?.ratePence || null;
  const dailyRatePence = hireView.continuingRatePence && hireView.continuingRatePence > 0 ? hireView.continuingRatePence : signedRate;
  const audatexRow = get<{
    reference: string | null;
    estimate_total_pence: number | null;
    labour_pence: number | null;
    parts_pence: number | null;
    paint_pence: number | null;
    authorised_total_pence: number | null;
    reduction_hourly_pence: number | null;
    reduction_hourly_note: string | null;
    reduction_times_pence: number | null;
    reduction_times_note: string | null;
    reduction_parts_pence: number | null;
    reduction_parts_note: string | null;
    reduction_other_pence: number | null;
    reduction_other_note: string | null;
  }>(
    `SELECT reference, estimate_total_pence, labour_pence, parts_pence, paint_pence, authorised_total_pence,
            reduction_hourly_pence, reduction_hourly_note, reduction_times_pence, reduction_times_note,
            reduction_parts_pence, reduction_parts_note, reduction_other_pence, reduction_other_note
     FROM audatex_estimates WHERE claim_id = ? ORDER BY recorded_at DESC LIMIT 1`,
    [id],
  );
  const audatex: AudatexFacts | null = audatexRow
    ? {
        reference: audatexRow.reference,
        estimatePence: audatexRow.estimate_total_pence,
        labourPence: audatexRow.labour_pence,
        partsPence: audatexRow.parts_pence,
        paintPence: audatexRow.paint_pence,
        authorisedPence: audatexRow.authorised_total_pence,
        hourly: { pence: audatexRow.reduction_hourly_pence, note: audatexRow.reduction_hourly_note },
        times: { pence: audatexRow.reduction_times_pence, note: audatexRow.reduction_times_note },
        partsReduction: { pence: audatexRow.reduction_parts_pence, note: audatexRow.reduction_parts_note },
        other: { pence: audatexRow.reduction_other_pence, note: audatexRow.reduction_other_note },
      }
    : null;
  const storageStatus = String(claim.storage_status || "");
  // Fee choices kept from the new-claim form are not a charge until the recovery itself is recorded (step 2).
  const recoveryRecorded = events.some((event) => event.event_type === "recovery_completed");
  const recoveryCharge =
    recoveryRecorded && ((byHead.get("recovery")?.claimedPence || 0) > 0 || data.recoveryJobs.some((job) => Number(job.charge_pence) > 0));

  function pay(key: ClaimPaymentLineInput["key"], head: string, label: string, endConfirmed: boolean | null): ClaimPaymentLineInput {
    const row = byHead.get(head);
    const chaseKind =
      key === "repairs" ? (totalLoss ? "settlement_payment" : "repair_payment") : key === "recovery" ? "recovery_payment" : key === "storage" ? "storage_payment" : "hire_payment";
    const chase = chaseRows.find((item) => item.kind === chaseKind);
    const received = row?.receivedPence || 0;
    return {
      key,
      label,
      endConfirmed,
      chargeRecorded: key === "recovery" ? recoveryCharge : (row?.claimedPence || 0) > 0 || (row?.agreedPence || 0) > 0,
      requestSent: REQUEST_EVENTS[key].some((type) => eventTypes.has(type)),
      intervalDays: chase?.intervalDays ?? null,
      receivedPence: received,
      paidInFull: Boolean(chase?.payment?.paidInFull),
      partPaid: Boolean(chase?.payment?.partPaid),
    };
  }

  const hireStatus = String(claim.hire_status || "");
  const proposedHire = get<{ review: string | null; collected: string | null }>(
    `SELECT hire_end_review_on AS review, collection_at AS collected FROM hire_episodes
     WHERE claim_id = ? AND started_at IS NOT NULL AND (billing_end_at IS NULL OR billing_end_at = '')
     ORDER BY started_at DESC LIMIT 1`,
    [id],
  );
  const hireEndProposedOn = String(proposedHire?.review || proposedHire?.collected || "").slice(0, 10) || null;
  const storageView = String(claim.storage_started_on || "").trim() ? storageAuthorisationEndForClaim(id) : null;
  const storageEndProposal =
    storageView?.kind === "suggest"
      ? { day: storageView.date, note: proposedStorageEndSentence(storageView.basis, storageView.earlierThanAuthorisation) }
      : null;
  const offHireView = totalLoss ? totalLossOffHireForClaim(id) : null;
  const offHire =
    offHireView?.kind === "suggest"
      ? { day: offHireView.date, reasons: [] }
      : offHireView?.kind === "review"
        ? { day: null, reasons: offHireView.reasons }
        : null;
  return deriveClaimSteps({
    claimId: id,
    claimType: String(claim.claim_type || ""),
    roadworthiness: String(claim.roadworthiness || ""),
    needsReplacement: Number(claim.needs_replacement) === 1,
    needsRecovery: Number(claim.needs_recovery) === 1,
    createdAt: claim.created_at ? String(claim.created_at) : null,
    clientName: String(claim.client_name || ""),
    accidentAt: claim.accident_at ? String(claim.accident_at) : null,
    registration: claim.registration ? String(claim.registration) : "",
    insurerExpected: fault || String(claim.claim_type || "") === "non_fault",
    insurerName,
    totalLoss,
    hasHireEvidence: data.hire.length > 0 || data.reservations.length > 0 || (hireStatus !== "" && hireStatus !== "none"),
    prehireDone: hireAgreementPrehireBlock(id) === null,
    vehicleChosen: data.hire.length > 0 || data.reservations.length > 0,
    agreementDone: data.agreements.length > 0,
    dailyRatePence,
    recoveryFlagComplete: ["complete", "completed"].includes(String(claim.recovery_status || "")),
    reportFlagged: String(claim.engineering_status || "") === "report_received",
    storageOnFile:
      (storageStatus !== "" && storageStatus !== "none") ||
      Boolean(String(claim.storage_started_on || "").trim()) ||
      Boolean(String(claim.storage_billing_end_on || "").trim()),
    storageEndedOn: storageStatus === "ended" && claim.storage_billing_end_on ? String(claim.storage_billing_end_on) : null,
    hireEndedOn: hireStatus === "ended" && hireView.confirmedEndDay ? hireView.confirmedEndDay : null,
    salvageRecorded: false,
    audatex,
    hireEndProposedOn,
    storageEndProposal,
    offHire,
    qualifyingOffHireOn:
      Number(claim.payment_qualifies_off_hire) === 1 && claim.off_hire_scheduled_on ? String(claim.off_hire_scheduled_on) : null,
    events,
    chases,
    payments: [
      pay("repairs", totalLoss ? "vehicle_damage" : "repairs", totalLoss ? "Vehicle damage" : "Repairs", null),
      pay("recovery", "recovery", "Recovery", null),
      pay("storage", "storage", "Storage", Boolean(String(claim.storage_billing_end_on || "").trim())),
      pay("hire", "hire", "Hire", Boolean(hireView.confirmedEndDay)),
    ],
  });
}
