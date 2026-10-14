import type { DatabaseSync } from "node:sqlite";
import { INDICATIVE_DEFAULTS } from "../constants";
import { londonTodayIso, nowUtcIso } from "../dates";
import { normaliseRecoveryScreen } from "../domain/recovery-charges";
import { inclusiveStorageDays, ukDayLabel } from "../domain/storage-charge";
import { grossFromNet } from "../money";

/**
 * Gives TEST-0005 a storage start and a recovery record on a database that was seeded earlier.
 * Does not write storage_billing_end_on, so a proposed end stays unconfirmed and other files' ends stay as they are.
 */
export function ensureTest0005StorageDemonstration(db: DatabaseSync, options?: { financialLines?: boolean }) {
  const claim = db.prepare(`SELECT id, storage_started_on FROM claims WHERE id = 'c5'`).get() as
    | { id: string; storage_started_on: string | null }
    | undefined;
  if (!claim) return;
  clearUnconfirmedTest0005End(db);
  const endsBefore = db.prepare(`SELECT id, storage_billing_end_on FROM claims`).all() as Array<{
    id: string;
    storage_billing_end_on: string | null;
  }>;
  if (!String(claim.storage_started_on || "").trim()) {
    db.prepare(
      `UPDATE claims SET storage_started_on = '2026-09-22', storage_status = 'active', recovery_status = 'complete' WHERE id = 'c5'`,
    ).run();
  }
  const job = db.prepare(`SELECT id FROM recovery_jobs WHERE claim_id = 'c5' LIMIT 1`).get();
  if (!job) {
    db.prepare(
      `INSERT INTO recovery_jobs(
        id, claim_id, location, recovered_at, charge_pence, winch_pence, ooh_pence, environmental_pence,
        forklift_pence, mileage_pence, manual_pence, inherited
      ) VALUES ('rec-c5','c5','Caerleon Road, Newport','2026-09-22', 39500, 0, 0, 0, 0, 0, 0, 0)`,
    ).run();
  }
  const screen = db.prepare(`SELECT claim_id FROM claim_screen_data WHERE claim_id = 'c5' AND screen_key = 'recovery'`).get();
  if (!screen) {
    db.prepare(`INSERT INTO claim_screen_data(claim_id, screen_key, data_json, updated_at) VALUES ('c5', 'recovery', ?, ?)`).run(
      JSON.stringify({
        name: "Demo Driver",
        location: "Caerleon Road, Newport",
        recoveryDate: "2026-09-22",
        standardCharge: "39500",
      }),
      nowUtcIso(),
    );
  }
  const driver = db.prepare(`SELECT id FROM staff WHERE id = 'staff-driver'`).get();
  const assignment = db
    .prepare(`SELECT id FROM day_assignments WHERE claim_id = 'c5' AND job_kind = 'client_recovery' LIMIT 1`)
    .get();
  if (driver && !assignment) {
    const now = nowUtcIso();
    db.prepare(
      `INSERT INTO day_assignments(
        id, assignee_id, job_kind, claim_id, work_date, created_by, created_at, completed_at, actual_driver_id, actual_occurred_at
      ) VALUES ('job-c5-recovery','staff-driver','client_recovery','c5','2026-09-22','staff-sian', ?, ?, 'staff-driver', '2026-09-22T10:00:00.000Z')`,
    ).run(now, now);
  }
  const authorised = db
    .prepare(`SELECT id FROM claim_events WHERE claim_id = 'c5' AND event_type = 'repairs_authorised' LIMIT 1`)
    .get();
  if (!authorised) {
    db.prepare(
      `INSERT INTO claim_events(
        id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, channel, source
      ) VALUES ('ev-c5-auth','c5','repairs_authorised','Repair authorisation received',
        'Repair authorisation received. Stored so the storage end can be proposed. Not confirmed.',
        '2026-10-01T09:00:00.000Z', ?, 'staff-sian', 'system', 'staff')`,
    ).run(nowUtcIso());
  }
  const endsAfter = db.prepare(`SELECT id, storage_billing_end_on FROM claims`).all() as Array<{
    id: string;
    storage_billing_end_on: string | null;
  }>;
  for (const before of endsBefore) {
    const after = endsAfter.find((row) => row.id === before.id);
    if ((after?.storage_billing_end_on || null) !== (before.storage_billing_end_on || null)) {
      throw new Error("A storage end date was changed while preparing TEST-0005. That must not happen.");
    }
  }
  if (options?.financialLines) {
    ensureCalculatedLine(db, "storage");
    ensureCalculatedLine(db, "recovery");
  }
}

/**
 * TEST-0005's proposal stays unconfirmed. An end stored without a confirmation, while the
 * storage line is still labelled provisional, is the old count-to-today figure and is cleared.
 * A confirmation event, or a line that is no longer provisional, is left as it is.
 */
function clearUnconfirmedTest0005End(db: DatabaseSync) {
  const confirmed = db
    .prepare(
      `SELECT id FROM claim_events WHERE claim_id = 'c5' AND event_type = 'storage_end_date_confirmed' LIMIT 1`,
    )
    .get();
  if (confirmed) return;
  const line = db
    .prepare(
      `SELECT description FROM financial_lines WHERE claim_id = 'c5' AND head_of_loss = 'storage' ORDER BY id LIMIT 1`,
    )
    .get() as { description: string | null } | undefined;
  if (line && !String(line.description || "").toLowerCase().includes("provisional")) return;
  db.prepare(`UPDATE claims SET storage_billing_end_on = NULL WHERE id = 'c5'`).run();
}

function ensureCalculatedLine(db: DatabaseSync, head: "storage" | "recovery") {
  const existing = db
    .prepare(`SELECT id, agreed_pence, received_pence FROM financial_lines WHERE claim_id = 'c5' AND head_of_loss = ? ORDER BY id LIMIT 1`)
    .get(head) as { id: string; agreed_pence: number; received_pence: number } | undefined;
  const priced = head === "storage" ? storageFigure(db) : recoveryFigure(db);
  if (existing) {
    if (head !== "storage" || !priced) return;
    db.prepare(
      `UPDATE financial_lines
       SET description = ?, quantity = ?, unit = ?, rate_pence = ?, net_pence = ?, vat_pence = ?, gross_pence = ?, claimed_pence = ?
       WHERE id = ?`,
    ).run(priced.description, priced.quantity, priced.unit, priced.rate, priced.net, priced.vat, priced.gross, priced.gross, existing.id);
    const after = db
      .prepare(`SELECT agreed_pence, received_pence FROM financial_lines WHERE id = ?`)
      .get(existing.id) as { agreed_pence: number; received_pence: number };
    if (after.agreed_pence !== existing.agreed_pence || after.received_pence !== existing.received_pence) {
      throw new Error("Refreshing TEST-0005 storage changed agreed or received. That must not happen.");
    }
    return;
  }
  if (!priced) return;
  db.prepare(
    `INSERT INTO financial_lines(
      id, claim_id, head_of_loss, description, quantity, unit, rate_pence, net_pence, vat_pence, gross_pence,
      claimed_pence, offered_pence, agreed_pence, received_pence, offer_status
    ) VALUES (?, 'c5', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, NULL)`,
  ).run(
    `${head}-c5`,
    head,
    head === "storage" ? priced.description : "Recovery",
    priced.quantity,
    priced.unit,
    priced.rate,
    priced.net,
    priced.vat,
    priced.gross,
    priced.gross,
  );
}

function storageFigure(db: DatabaseSync) {
  const claim = db.prepare(`SELECT storage_started_on, storage_billing_end_on, storage_rate_pence FROM claims WHERE id = 'c5'`).get() as {
    storage_started_on: string | null;
    storage_billing_end_on: string | null;
    storage_rate_pence: number | null;
  };
  const start = String(claim.storage_started_on || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const confirmed = String(claim.storage_billing_end_on || "").slice(0, 10);
  const confirmedDay = /^\d{4}-\d{2}-\d{2}$/.test(confirmed) ? confirmed : null;
  const proposedRow = confirmedDay
    ? undefined
    : (db
        .prepare(
          `SELECT occurred_at FROM claim_events WHERE claim_id = 'c5' AND event_type = 'repairs_authorised' ORDER BY occurred_at DESC LIMIT 1`,
        )
        .get() as { occurred_at: string } | undefined);
  const proposed = proposedRow ? String(proposedRow.occurred_at).slice(0, 10) : "";
  const proposedDay = /^\d{4}-\d{2}-\d{2}$/.test(proposed) ? proposed : null;
  const end = confirmedDay || proposedDay || londonTodayIso();
  const days = inclusiveStorageDays(start, end);
  if (days == null) return null;
  const setting = db.prepare(`SELECT value FROM settings WHERE key = 'storage_daily_rate_pence'`).get() as { value: string } | undefined;
  const rate = claim.storage_rate_pence ?? (Number.parseInt(setting?.value || "", 10) || INDICATIVE_DEFAULTS.storage_per_day_net_pence);
  const money = grossFromNet(days * rate, INDICATIVE_DEFAULTS.vat_rate);
  const description = confirmedDay
    ? "Storage"
    : proposedDay
      ? `Storage, provisional, to proposed end ${ukDayLabel(proposedDay)}, awaiting confirmation`
      : "Storage, provisional to today";
  return { quantity: days, unit: "days", rate, net: money.net, vat: money.vat, gross: money.gross, description };
}

function recoveryFigure(db: DatabaseSync) {
  const row = db.prepare(`SELECT data_json FROM claim_screen_data WHERE claim_id = 'c5' AND screen_key = 'recovery'`).get() as
    | { data_json: string }
    | undefined;
  const saved = row?.data_json ? (JSON.parse(row.data_json) as Record<string, string>) : { standardCharge: "39500" };
  const normalised = normaliseRecoveryScreen(saved);
  const gross = Number.parseInt(normalised.total || "0", 10) || 0;
  const vat = Number.parseInt(normalised.vat || "0", 10) || 0;
  return { quantity: 1, unit: "job", rate: gross, net: gross - vat, vat, gross };
}
