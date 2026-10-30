import { formatUkDateTime, londonDateIso, nowUtcIso } from "../dates";
import { NOT_DRIVEABLE_REASONS, notDriveableLabel, recordRecoveryMovement } from "./vehicle-movements";
import { getDefaultVehicleLocation } from "./vehicle-location";
import { getScreenData } from "./screens";
import { sumRecoveryLines, type RecoveryMoneyLine } from "../domain/recovery-fees";
import { FieldValidationError } from "../form-validation";
import { formatGbp } from "../money";
import { recordClaimEvent } from "./chronology";
import { get, newId, run } from "./connection";
import { parseRecoveryForm, recoveryInstantFromParts } from "./intake-recovery-form";
import { calendarDay } from "./storage-recovery-date";

/**
 * Records step 2: the car has been recovered and has arrived at the yard.
 * The charges are the ones the handler ticked and confirmed on the form, each plus VAT. Nothing is added silently.
 * Storage starts on the day the car arrived at the yard. A different storage start already on the file is not
 * overwritten; it is flagged for a person to choose, as before.
 */
export function recordRecoveryDone(input: { claimId: string; actorId: string; form: FormData }) {
  const claim = get<{
    id: string;
    accident_at: string | null;
    storage_started_on: string | null;
    storage_status: string | null;
  }>(`SELECT id, accident_at, storage_started_on, storage_status FROM claims WHERE id = ?`, [input.claimId]);
  if (!claim) throw new Error("File not found.");
  const form = input.form;
  form.set("recoveryFormVersion", "fees");
  const parsed = parseRecoveryForm(form, (f, name) => String(f.get(name) || "").trim());
  if (parsed.fieldError) throw new FieldValidationError(parsed.fieldError.field, parsed.fieldError.message);
  const arrivedAt = recoveryInstantFromParts(String(form.get("arrivedDate") || ""), String(form.get("arrivedTime") || ""));
  if (!arrivedAt) throw new FieldValidationError("arrivedDate", "Enter the date and time the car arrived at the yard.");
  if (arrivedAt > nowUtcIso()) throw new FieldValidationError("arrivedDate", "The arrival at the yard cannot be in the future.");
  if (claim.accident_at && arrivedAt < claim.accident_at) {
    throw new FieldValidationError("arrivedDate", "The arrival at the yard cannot be before the accident.");
  }
  const lines: RecoveryMoneyLine[] = (parsed.lines || []).filter((line) => line.key !== "inherited");
  const job = get<{ id: string; charge_lines_json: string | null }>(
    `SELECT id, charge_lines_json FROM recovery_jobs WHERE claim_id = ? ORDER BY id LIMIT 1`,
    [input.claimId],
  );
  // An inherited charge typed on the new-claim form stays: it is a receipt, not a CAS fee. A card fee saved under the
  // old tick stays too (R19): card fees are now added when a card payment is recorded, and the saved figure is kept.
  const inherited = (() => {
    try {
      return (JSON.parse(String(job?.charge_lines_json || "[]")) as RecoveryMoneyLine[]).filter((line) => line.key === "inherited" || line.key === "cardFee");
    } catch {
      return [];
    }
  })();
  const allLines = [...lines, ...inherited];
  const totals = sumRecoveryLines(allLines);
  const head = get<{ id: string; agreed_pence: number; received_pence: number; claimed_pence: number }>(
    `SELECT id, agreed_pence, received_pence, claimed_pence FROM financial_lines WHERE claim_id = ? AND head_of_loss = 'recovery' ORDER BY id LIMIT 1`,
    [input.claimId],
  );
  if (head && (Number(head.agreed_pence) > 0 || Number(head.received_pence) > 0) && Number(head.claimed_pence) !== totals.grossPence) {
    throw new Error("The recovery charge already has an agreed figure or a payment. Change the charges on the recovery money screen instead.");
  }
  const location = String(form.get("recoveryLocation") || "").trim();
  // Evidence that recovery was necessary, captured as the recovery is recorded.
  if (!location) throw new FieldValidationError("recoveryLocation", "Enter where the car was.");
  const condition = String(form.get("carCondition") || "").trim();
  if (!condition) throw new FieldValidationError("carCondition", "Describe the car's condition when it was recovered.");
  const notDriveable = String(form.get("notDriveable") || "").trim();
  if (!NOT_DRIVEABLE_REASONS.some((item) => item.value === notDriveable)) {
    throw new FieldValidationError("notDriveable", "Choose why the car could not be driven safely.");
  }
  const notDriveableDetail = String(form.get("notDriveableDetail") || "").trim();
  const amounts: Record<string, number> = {};
  for (const line of lines) amounts[line.key] = line.netPence;
  const jobValues = [
    location || null,
    arrivedAt,
    amounts.standard || 0,
    amounts.winching || 0,
    amounts.outOfHours || 0,
    amounts.environmental || 0,
    amounts.forklift || 0,
    amounts.manual || 0,
    allLines.length ? JSON.stringify(allLines) : null,
    parsed.manualDescription || null,
    amounts.specialistWinching || 0,
    amounts.skates || 0,
    amounts.waiting || 0,
    amounts.secondOperator || 0,
    condition,
    notDriveable,
    notDriveableDetail || null,
  ];
  if (job) {
    run(
      `UPDATE recovery_jobs SET location = COALESCE(?, location), recovered_at = ?, charge_pence = ?, winch_pence = ?, ooh_pence = ?,
         environmental_pence = ?, forklift_pence = ?, manual_pence = ?, charge_lines_json = ?, manual_description = ?,
         specialist_winch_pence = ?, skates_pence = ?, waiting_pence = ?, second_operator_pence = ?,
         car_condition = ?, not_driveable_reason = ?, not_driveable_detail = ?
       WHERE id = ?`,
      [...jobValues, job.id],
    );
  } else {
    run(
      `INSERT INTO recovery_jobs(id, claim_id, location, recovered_at, charge_pence, winch_pence, ooh_pence, environmental_pence,
         forklift_pence, manual_pence, charge_lines_json, manual_description, specialist_winch_pence, skates_pence, waiting_pence,
         second_operator_pence, car_condition, not_driveable_reason, not_driveable_detail, mileage_pence, inherited)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      [newId("rec"), input.claimId, ...jobValues],
    );
  }
  if (head) {
    run(
      `UPDATE financial_lines SET description = 'Recovery', quantity = 1, unit = 'job', rate_pence = ?, net_pence = ?, vat_pence = ?, gross_pence = ?, claimed_pence = ?
       WHERE id = ?`,
      [totals.netPence, totals.netPence, totals.vatPence, totals.grossPence, totals.grossPence, head.id],
    );
  } else if (totals.grossPence > 0) {
    run(
      `INSERT INTO financial_lines(id, claim_id, head_of_loss, description, quantity, unit, rate_pence, net_pence, vat_pence, gross_pence,
         claimed_pence, offered_pence, agreed_pence, received_pence, offer_status)
       VALUES (?, ?, 'recovery', 'Recovery', 1, 'job', ?, ?, ?, ?, ?, 0, 0, 0, NULL)`,
      [newId("fin"), input.claimId, totals.netPence, totals.netPence, totals.vatPence, totals.grossPence, totals.grossPence],
    );
  }
  run(`UPDATE claims SET recovery_status = 'completed' WHERE id = ?`, [input.claimId]);

  const arrivedDay = londonDateIso(new Date(arrivedAt));
  const storageDay = calendarDay(claim.storage_started_on);
  let storageWords = "";
  if (!storageDay) {
    run(`UPDATE claims SET storage_started_on = ?, storage_status = CASE WHEN storage_status IS NULL OR storage_status = 'none' THEN 'active' ELSE storage_status END WHERE id = ?`, [
      arrivedDay,
      input.claimId,
    ]);
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "storage_started",
      occurredAt: arrivedAt,
      actorId: input.actorId,
      details: `Storage starts on ${formatUkDateTime(arrivedAt).slice(0, 10)}, the day the car arrived at the yard. The end is not set automatically.`,
      source: "staff",
    });
    storageWords = " Storage starts the same day.";
  } else if (storageDay !== arrivedDay) {
    run(`UPDATE claims SET storage_date_review_on = ? WHERE id = ?`, [arrivedDay, input.claimId]);
    storageWords = " Storage already starts on a different day, so that date was not changed. Choose which day on the storage screen.";
  }
  const charged = lines.length
    ? lines.map((line) => `${line.label} ${formatGbp(line.netPence)}${line.reason ? ` (${line.reason})` : ""}`).join(", ")
    : "no CAS charge";
  const already = get<{ id: string }>(`SELECT id FROM claim_events WHERE claim_id = ? AND event_type = 'recovery_completed' LIMIT 1`, [input.claimId]);
  recordClaimEvent({
    claimId: input.claimId,
    eventType: already ? "other" : "recovery_completed",
    occurredAt: already ? nowUtcIso() : arrivedAt,
    actorId: input.actorId,
    details: `${already ? "Recovery charges changed. " : ""}Car recovered${location ? ` from ${location}` : ""} and arrived at the yard ${formatUkDateTime(arrivedAt)}. Condition: ${condition}. Could not be driven: ${notDriveableLabel(notDriveable).toLowerCase()}${notDriveableDetail ? ` (${notDriveableDetail})` : ""}. Charges: ${charged}. Total ${formatGbp(totals.netPence)} + VAT ${formatGbp(totals.vatPence)} = ${formatGbp(totals.grossPence)}.${storageWords}`,
    source: "staff",
  });
  recordRecoveryMovement({
    claimId: input.claimId,
    actorId: input.actorId,
    movedOn: arrivedDay,
    from: location,
    to: storedYard(input.claimId),
  });
  return { arrivedAt, ...totals };
}

/** Where the car went: the storage address saved on the file, or CAS's own premises. */
function storedYard(claimId: string): string {
  const storage = getScreenData(claimId, "storage");
  const stored = [storage.name, storage.address, storage.postcode].map((part) => String(part || "").trim()).filter(Boolean).join(", ");
  return stored || getDefaultVehicleLocation();
}
