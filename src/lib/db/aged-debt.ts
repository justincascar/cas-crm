import { londonDateIso, londonTodayIso } from "../dates";
import { AGED_DEBT_BANDS, PAYMENT_REQUEST_EVENTS, agedDebtBand, type AgedDebtBand } from "../domain/aged-debt";
import { lineOutstanding } from "../domain/head-outstanding";
import { londonCalendarDayGap } from "../domain/storage-authorisation-end";
import { all } from "./connection";
import { unconfirmedHireClaimIds } from "./hire-charge";
import { unconfirmedStorageClaimIds } from "./storage-charge";

export type AgedDebtRow = {
  claimId: string;
  fileReference: string;
  clientName: string;
  head: string;
  outstandingPence: number;
  requestedOn: string | null;
  ageDays: number | null;
  band: AgedDebtBand;
};

/**
 * Every head of loss with money still owed: the agreed figure, or a confirmed claimed figure, less what was received.
 * A provisional hire or storage figure is not counted. Offers are never counted as money owed or received.
 */
export function listAgedDebt(today = londonTodayIso()): { rows: AgedDebtRow[]; totals: Record<AgedDebtBand, number> } {
  const lines = all<{
    claim_id: string;
    file_reference: string;
    client_name: string | null;
    head_of_loss: string;
    claimed_pence: number | null;
    agreed_pence: number | null;
    received_pence: number | null;
  }>(
    `SELECT f.claim_id, c.file_reference, p.full_name AS client_name, f.head_of_loss, f.claimed_pence, f.agreed_pence, f.received_pence
     FROM financial_lines f
     JOIN claims c ON c.id = f.claim_id
     LEFT JOIN people p ON p.id = c.client_person_id
     ORDER BY c.file_reference, f.head_of_loss`,
  );
  const requests = all<{ claim_id: string; event_type: string; first_at: string }>(
    `SELECT claim_id, event_type, MIN(occurred_at) AS first_at FROM claim_events
     WHERE event_type LIKE '%payment_request_sent' GROUP BY claim_id, event_type`,
  );
  const unconfirmedHire = unconfirmedHireClaimIds();
  const unconfirmedStorage = unconfirmedStorageClaimIds();
  const rows: AgedDebtRow[] = [];
  for (const line of lines) {
    const head = line.head_of_loss;
    const provisional =
      ((head === "hire" || head === "credit_hire") && unconfirmedHire.has(line.claim_id)) ||
      (head === "storage" && unconfirmedStorage.has(line.claim_id));
    const owed = lineOutstanding({
      claimId: line.claim_id,
      fileReference: line.file_reference,
      head,
      offeredPence: 0,
      agreedPence: Number(line.agreed_pence || 0),
      claimedPence: Number(line.claimed_pence || 0),
      receivedPence: Number(line.received_pence || 0),
      claimedConfirmed: !provisional,
    });
    if (!owed.outstandingPence || owed.outstandingPence <= 0) continue;
    const types = PAYMENT_REQUEST_EVENTS[head] || [];
    const sent = requests
      .filter((row) => row.claim_id === line.claim_id && types.includes(row.event_type))
      .map((row) => row.first_at)
      .sort()[0];
    const requestedOn = sent ? londonDateIso(new Date(sent)) : null;
    const ageDays = requestedOn ? Math.max(0, londonCalendarDayGap(requestedOn, today)) : null;
    rows.push({
      claimId: line.claim_id,
      fileReference: line.file_reference,
      clientName: String(line.client_name || ""),
      head,
      outstandingPence: owed.outstandingPence,
      requestedOn,
      ageDays,
      band: agedDebtBand(ageDays),
    });
  }
  const totals = Object.fromEntries(AGED_DEBT_BANDS.map((band) => [band, 0])) as Record<AgedDebtBand, number>;
  for (const row of rows) totals[row.band] += row.outstandingPence;
  rows.sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1) || a.fileReference.localeCompare(b.fileReference));
  return { rows, totals };
}
