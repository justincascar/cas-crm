import { TOTAL_LOSS_PAYMENT_RECEIVED_EVENT } from "../domain/follow-up-chases";
import {
  hireCharge,
  type HireCharge,
  type HireAgreementInput,
} from "../domain/hire-charge";
import { salvageRequestMismatch, salvageSaleVariance, type CasSalvageRequest, type InsurerSalvageInterest } from "../domain/total-loss";
import { totalLossOffHireDecision } from "../domain/total-loss-off-hire";
import { londonDateIso, londonTodayIso } from "../dates";
import { all, get, run } from "./connection";

function calendarDay(value: string | null | undefined): string | null {
  const text = (value || "").trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return londonDateIso(parsed);
}

export type StoredHireMoney = {
  claimedPence: number;
  agreedPence: number;
  receivedPence: number;
  offeredPence: number;
};

export type HireChargeView = {
  charge: HireCharge;
  stored: StoredHireMoney;
  differs: boolean;
  handoverDay: string | null;
  confirmedEndDay: string | null;
  proposedEndDay: string | null;
  creditHire: boolean;
  suppliedVehicle: string;
  agreements: Array<HireAgreementInput & { id: string; signatureStatus: string }>;
  continuingRatePence: number | null;
};

type EpisodeRow = {
  id: string;
  started_at: string | null;
  billing_end_at: string | null;
  hire_end_proposed_on: string | null;
  credit_hire: number | null;
  rate_pence_per_day: number | null;
  registration: string | null;
  make: string | null;
  model: string | null;
};

function episodes(claimId: string) {
  return all<EpisodeRow>(
    `SELECT he.id, he.started_at, he.billing_end_at, he.hire_end_proposed_on, he.credit_hire, he.rate_pence_per_day,
            v.registration, v.make, v.model
     FROM hire_episodes he
     LEFT JOIN fleet_vehicles fv ON fv.id = he.fleet_vehicle_id
     LEFT JOIN vehicles v ON v.id = fv.vehicle_id
     WHERE he.claim_id = ?
     ORDER BY he.started_at ASC`,
    [claimId],
  );
}

function handoverDays(claimId: string): string[] {
  const rows = all<{ occurred_at: string }>(
    `SELECT occurred_at FROM vehicle_handovers
     WHERE claim_id = ? AND event_kind = 'hire_delivered'
     ORDER BY occurred_at ASC`,
    [claimId],
  );
  const days: string[] = [];
  for (const row of rows) {
    const day = calendarDay(row.occurred_at);
    if (day && !days.includes(day)) days.push(day);
  }
  return days;
}

function agreementRows(claimId: string) {
  return all<{
    id: string;
    sequence: number;
    start_on: string | null;
    signed: number;
    signature_status: string | null;
    rate_pence_per_day: number | null;
  }>(
    `SELECT a.id, a.sequence, a.start_on, a.signed, a.signature_status, a.rate_pence_per_day
     FROM agreements a
     JOIN hire_episodes he ON he.id = a.hire_episode_id
     WHERE he.claim_id = ?
     ORDER BY a.sequence ASC`,
    [claimId],
  );
}

export function storedHireMoney(claimId: string): StoredHireMoney {
  const rows = all<{ claimed_pence: number; agreed_pence: number; received_pence: number; offered_pence: number }>(
    `SELECT claimed_pence, agreed_pence, received_pence, offered_pence
     FROM financial_lines WHERE claim_id = ? AND head_of_loss IN ('hire', 'credit_hire')`,
    [claimId],
  );
  return rows.reduce(
    (sum, row) => ({
      claimedPence: sum.claimedPence + (Number(row.claimed_pence) || 0),
      agreedPence: sum.agreedPence + (Number(row.agreed_pence) || 0),
      receivedPence: sum.receivedPence + (Number(row.received_pence) || 0),
      offeredPence: sum.offeredPence + (Number(row.offered_pence) || 0),
    }),
    { claimedPence: 0, agreedPence: 0, receivedPence: 0, offeredPence: 0 },
  );
}

function proposedTotalLossEnd(claimId: string, confirmedEndDay: string | null): string | null {
  if (confirmedEndDay) return null;
  const claim = get<{ total_loss: number | null }>(`SELECT total_loss FROM claims WHERE id = ?`, [claimId]);
  if (!claim || Number(claim.total_loss) !== 1) return null;
  const money = get<{ agreed_pence: number; received_pence: number }>(
    `SELECT agreed_pence, received_pence FROM financial_lines
     WHERE claim_id = ? AND head_of_loss = 'vehicle_damage' ORDER BY id LIMIT 1`,
    [claimId],
  );
  const report = get<{
    salvage_pence: number | null;
    sale_proceeds_pence: number | null;
    disposal: string | null;
    cas_request: string | null;
    insurer_salvage_interest: string | null;
  }>(
    `SELECT salvage_pence, sale_proceeds_pence, disposal, cas_request, insurer_salvage_interest
     FROM total_loss_reports WHERE claim_id = ?`,
    [claimId],
  );
  const payment = get<{ occurred_at: string }>(
    `SELECT occurred_at FROM claim_events WHERE claim_id = ? AND event_type = ? ORDER BY occurred_at DESC LIMIT 1`,
    [claimId, TOTAL_LOSS_PAYMENT_RECEIVED_EVENT],
  );
  const kept = get<{ details: string | null }>(
    `SELECT details FROM claim_events WHERE claim_id = ? AND event_type = 'hire_end_date_confirmed' AND details LIKE 'Kept the hire end%'
     ORDER BY occurred_at DESC LIMIT 1`,
    [claimId],
  );
  const keptDay = String(kept?.details || "").match(/suggested (\d{4}-\d{2}-\d{2})/)?.[1] || null;
  const decision = totalLossOffHireDecision({
    agreedPence: Number(money?.agreed_pence) || 0,
    receivedPence: Number(money?.received_pence) || 0,
    paymentAt: payment?.occurred_at || null,
    salvageVariancePence:
      report?.disposal === "sold" ? salvageSaleVariance(report.salvage_pence, report.sale_proceeds_pence) : null,
    salvageMismatch: salvageRequestMismatch(
      (report?.cas_request as CasSalvageRequest | null) || null,
      (report?.insurer_salvage_interest as InsurerSalvageInterest | null) || null,
    ),
    existingHireEndDay: confirmedEndDay,
    keptSuggestionDay: keptDay,
  });
  if (decision.kind === "suggest") return decision.date;
  return null;
}

export function hireChargeForClaim(claimId: string, today = londonTodayIso()): HireChargeView {
  const rows = episodes(claimId);
  const delivered = handoverDays(claimId);
  const handoverDay = delivered[0] || null;
  const confirmedEndDay = rows.map((row) => calendarDay(row.billing_end_at)).filter((day): day is string => Boolean(day)).sort().at(-1) || null;
  const proposedOnFile = rows.map((row) => calendarDay(row.hire_end_proposed_on)).find((day) => Boolean(day)) || null;
  const proposedEndDay = proposedTotalLossEnd(claimId, confirmedEndDay) || (confirmedEndDay ? null : proposedOnFile);
  const creditHire = rows.some((row) => Number(row.credit_hire) === 1);
  const agreements = agreementRows(claimId).map((row) => ({
    id: String(row.id),
    sequence: Number(row.sequence),
    startDay: calendarDay(row.start_on),
    signed: Number(row.signed) === 1,
    signatureStatus: String(row.signature_status || ""),
    ratePence: row.rate_pence_per_day == null ? null : Number(row.rate_pence_per_day),
  }));
  const pack = get<{ daily_rate_pence: number | null; cdw_pence: number | null; additional_driver_pence: number | null; delivery_collection_pence: number | null }>(
    `SELECT daily_rate_pence, cdw_pence, additional_driver_pence, delivery_collection_pence FROM hire_pack_data WHERE claim_id = ?`,
    [claimId],
  );
  const signed = agreements.some((agreement) => agreement.signed);
  const episodeRate = rows.map((row) => Number(row.rate_pence_per_day) || 0).find((rate) => rate > 0) || null;
  const charge = hireCharge({
    handoverDay,
    confirmedEndDay,
    proposedEndDay,
    today,
    creditHire,
    agreements,
    generatedRatePence: signed ? pack?.daily_rate_pence : null,
    episodeRatePence: signed ? episodeRate : null,
    swapDays: delivered.slice(1),
    extrasOnSignedAgreement: signed && Boolean(pack),
    cdwPence: pack?.cdw_pence,
    additionalDriverPence: pack?.additional_driver_pence,
    deliveryCollectionPence: pack?.delivery_collection_pence,
  });
  const stored = storedHireMoney(claimId);
  const calculated = charge.status === "calculated" ? charge.totalPence : 0;
  const differs = stored.claimedPence > 0 && stored.claimedPence !== calculated;
  const vehicle = rows.find((row) => row.registration || row.make || row.model);
  const suppliedVehicle = [vehicle?.registration, vehicle?.make, vehicle?.model].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
  return {
    charge,
    stored,
    differs,
    handoverDay,
    confirmedEndDay,
    proposedEndDay,
    creditHire,
    suppliedVehicle,
    agreements,
    continuingRatePence: charge.status === "calculated" ? charge.continuingRatePence : null,
  };
}

function hireLine(claimId: string) {
  return get<{ id: string; agreed_pence: number; received_pence: number; offered_pence: number; claimed_pence: number }>(
    `SELECT id, agreed_pence, received_pence, offered_pence, claimed_pence FROM financial_lines
     WHERE claim_id = ? AND head_of_loss = 'hire' ORDER BY id LIMIT 1`,
    [claimId],
  );
}

/** Writes the calculation as claimed. Agreed, offered and received stay as they are. */
export function writeCalculatedHireClaimed(claimId: string, today = londonTodayIso()): boolean {
  const view = hireChargeForClaim(claimId, today);
  if (view.charge.status !== "calculated") return false;
  const charge = view.charge;
  const description = charge.label ? `Hire, ${charge.label.charAt(0).toLowerCase()}${charge.label.slice(1)}` : "Hire";
  const existing = hireLine(claimId);
  const agreedBefore = Number(existing?.agreed_pence) || 0;
  const receivedBefore = Number(existing?.received_pence) || 0;
  const offeredBefore = Number(existing?.offered_pence) || 0;
  const rate = charge.lines.length === 1 ? charge.lines[0].ratePence : 0;
  if (existing) {
    run(
      `UPDATE financial_lines
       SET description = ?, claimed_pence = ?, net_pence = ?, vat_pence = ?, gross_pence = ?, rate_pence = ?, quantity = ?, unit = ?
       WHERE id = ?`,
      [description, charge.totalPence, charge.netPence, charge.vatPence, charge.totalPence, rate, charge.days, "days", existing.id],
    );
  } else {
    run(
      `INSERT INTO financial_lines(
        id, claim_id, head_of_loss, description, quantity, unit, rate_pence, net_pence, vat_pence, gross_pence,
        claimed_pence, offered_pence, agreed_pence, received_pence, offer_status
      ) VALUES (?, ?, 'hire', ?, ?, 'days', ?, ?, ?, ?, ?, 0, 0, 0, NULL)`,
      [`hire-${claimId}`, claimId, description, charge.days, rate, charge.netPence, charge.vatPence, charge.totalPence, charge.totalPence],
    );
  }
  const after = hireLine(claimId);
  if (
    !after ||
    Number(after.agreed_pence) !== agreedBefore ||
    Number(after.received_pence) !== receivedBefore ||
    Number(after.offered_pence) !== offeredBefore
  ) {
    throw new Error("The hire claimed figure could not be saved without changing agreed, offered or received.");
  }
  return true;
}

/** Writes the calculation as claimed only when the file has no hire claimed figure yet. */
export function adoptHireClaimedIfNone(claimId: string, today = londonTodayIso()): boolean {
  const stored = storedHireMoney(claimId);
  if (stored.claimedPence > 0) return false;
  return writeCalculatedHireClaimed(claimId, today);
}

/** Claims whose hire end is not confirmed. Their hire claimed figure is provisional on lists. */
export function unconfirmedHireClaimIds(): Set<string> {
  const rows = all<{ claim_id: string }>(
    `SELECT DISTINCT f.claim_id
     FROM financial_lines f
     WHERE f.head_of_loss IN ('hire', 'credit_hire') AND f.claimed_pence > 0
       AND NOT EXISTS (
         SELECT 1 FROM hire_episodes he
         WHERE he.claim_id = f.claim_id AND he.billing_end_at IS NOT NULL AND trim(he.billing_end_at) != ''
       )`,
  );
  return new Set(rows.map((row) => String(row.claim_id)));
}

export function hireClaimIdsThatDiffer(today = londonTodayIso()): string[] {
  const claims = all<{ id: string; file_reference: string }>(
    `SELECT DISTINCT c.id, c.file_reference
     FROM claims c
     JOIN financial_lines f ON f.claim_id = c.id AND f.head_of_loss IN ('hire', 'credit_hire') AND f.claimed_pence > 0
     ORDER BY c.file_reference`,
  );
  return claims.filter((claim) => hireChargeForClaim(claim.id, today).differs).map((claim) => claim.file_reference);
}
