import { FILE_REFERENCE_PREFIX_DEFAULT, HEAD_LABELS, type HeadOfLoss } from "../constants";
import { accidentDateError, isBeforeLondonDay, isSameLondonDay, londonDateIso, nowUtcIso } from "../dates";
import { formatGbp, sumDistinctHeads } from "../money";
import { all, dbPath, get, newId, run } from "./connection";
import { canReserveVehicle, nextFileReference, parseFileReferenceNumber } from "../domain/rules";
import { listClaimEvents, recordClaimEvent } from "./chronology";
import { KEY_DATE_TYPES, eventLabel, latestDates } from "../domain/events";

export type ClaimListRow = {
  id: string;
  file_reference: string;
  current_position: string;
  client_name: string | null;
  insurer: string | null;
  handler_name: string | null;
  last_correspondence_at: string | null;
  next_action: string | null;
  next_action_due: string | null;
  claim_type: string;
  registration: string | null;
};

const CLAIM_LIST_SQL = `
  SELECT c.id, c.file_reference, c.current_position, p.full_name AS client_name,
         COALESCE(tp.insurer_name, c.own_insurer_name) AS insurer,
         s.name AS handler_name, c.last_correspondence_at, c.next_action, c.next_action_due,
         c.claim_type, v.registration
  FROM claims c
  LEFT JOIN people p ON p.id = c.client_person_id
  LEFT JOIN staff s ON s.id = c.handler_id
  LEFT JOIN vehicles v ON v.id = c.client_vehicle_id
  LEFT JOIN claim_third_parties tp ON tp.claim_id = c.id AND tp.id = (
    SELECT id FROM claim_third_parties WHERE claim_id = c.id LIMIT 1
  )
`;

export const QUEUE_LABELS: Record<string, string> = {
  new_enquiries: "New enquiries and incomplete submissions",
  tasks_today: "Tasks due today",
  tasks_overdue: "Overdue tasks",
  active_hire: "Active hire",
  storage: "Vehicles in storage",
  fleet_available: "Fleet availability",
  liability: "Awaited liability responses",
  engineer: "Awaited engineer reports",
  repair_auth: "Awaited repair authorisations",
  repairs_progress: "Repairs in progress",
  ready_return: "Vehicles ready for customer return",
  tl_payment: "Total-loss payments awaited",
  off_hire: "Off-hire dates approaching",
  salvage: "Salvage awaiting collection/disposal",
  renewals: "Agreement renewals approaching",
  unread: "Unread correspondence",
  offers: "Offers awaiting review",
  litigation: "Litigation deadlines",
};

export function listClaims(opts: { q?: string; queue?: string } = {}): ClaimListRow[] {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.q) {
    const like = `%${opts.q.trim()}%`;
    where.push(`(
      c.file_reference LIKE ? OR p.full_name LIKE ? OR v.registration LIKE ?
      OR c.own_claim_ref LIKE ? OR tp.insurer_ref LIKE ? OR tp.insurer_name LIKE ?
    )`);
    params.push(like, like, like, like, like, like);
  }
  if (opts.queue) {
    const extra = queueWhere(opts.queue);
    if (extra.sql) {
      where.push(extra.sql);
      params.push(...extra.params);
    }
  }
  const sql = CLAIM_LIST_SQL + (where.length ? ` WHERE ${where.join(" AND ")}` : "") + " ORDER BY c.file_reference";
  return all<ClaimListRow>(sql, params);
}

function queueWhere(queue: string): { sql: string; params: unknown[] } {
  switch (queue) {
    case "new_enquiries":
      return { sql: "(c.is_new_enquiry = 1 OR c.incomplete_client_submission = 1)", params: [] };
    case "active_hire":
      return { sql: "c.hire_status IN ('active', 'approaching_off_hire')", params: [] };
    case "storage":
      return { sql: "c.storage_status = 'active'", params: [] };
    case "liability":
      return { sql: "c.insurer_liability_position = 'pending'", params: [] };
    case "engineer":
      return { sql: "c.engineering_status IN ('instructed', 'awaiting_report')", params: [] };
    case "repair_auth":
      return { sql: "c.repair_status = 'awaiting_auth'", params: [] };
    case "repairs_progress":
      return { sql: "c.repair_status = 'in_progress'", params: [] };
    case "ready_return":
      return { sql: "c.repair_status = 'awaiting_return'", params: [] };
    case "tl_payment":
      return { sql: "c.total_loss = 1 AND c.payment_qualifies_off_hire = 0", params: [] };
    case "off_hire":
      return { sql: "c.hire_status = 'approaching_off_hire' OR (c.off_hire_scheduled_on IS NOT NULL AND c.hire_status != 'ended')", params: [] };
    case "salvage":
      return { sql: "c.salvage_status IN ('awaiting_collection', 'awaiting_disposal')", params: [] };
    case "renewals":
      return { sql: `c.id IN (SELECT he.claim_id FROM agreements a JOIN hire_episodes he ON he.id = a.hire_episode_id WHERE a.signature_status IN ('awaiting_signature','unsigned_urgent') OR (a.signed = 0 AND a.sequence > 1))`, params: [] };
    case "unread":
      return { sql: "c.id IN (SELECT claim_id FROM correspondence WHERE unread = 1)", params: [] };
    case "offers":
      return { sql: "c.id IN (SELECT claim_id FROM financial_lines WHERE offer_status = 'awaiting_review')", params: [] };
    case "litigation":
      return { sql: "c.id IN (SELECT claim_id FROM litigation)", params: [] };
    default:
      return { sql: "", params: [] };
  }
}

export function getDashboard() {
  const claims = listClaims();
  const tasks = all<{
    id: string;
    title: string;
    due_at: string | null;
    status: string;
    handler_name: string | null;
    file_reference: string | null;
    claim_id: string | null;
  }>(`
    SELECT t.id, t.title, t.due_at, t.status, s.name AS handler_name, c.file_reference, t.claim_id
    FROM tasks t
    LEFT JOIN staff s ON s.id = t.handler_id
    LEFT JOIN claims c ON c.id = t.claim_id
    WHERE t.status = 'open'
    ORDER BY t.due_at ASC
  `);

  const today = tasks.filter((t) => t.due_at && isSameLondonDay(t.due_at));
  const overdue = tasks.filter((t) => t.due_at && isBeforeLondonDay(t.due_at));

  const byHandler: Record<string, { today: number; overdue: number }> = {};
  for (const t of tasks) {
    const name = t.handler_name || "Unassigned";
    byHandler[name] ??= { today: 0, overdue: 0 };
    if (t.due_at && isSameLondonDay(t.due_at)) byHandler[name].today += 1;
    if (t.due_at && isBeforeLondonDay(t.due_at)) byHandler[name].overdue += 1;
  }

  const fleet = all<{ status: string; c: number }>("SELECT status, COUNT(*) AS c FROM fleet_vehicles GROUP BY status");
  const fleetMap = Object.fromEntries(fleet.map((r) => [r.status, Number(r.c)]));

  const lines = all<{
    head_of_loss: string;
    claimed_pence: number;
    offered_pence: number;
    agreed_pence: number;
    received_pence: number;
  }>("SELECT head_of_loss, claimed_pence, offered_pence, agreed_pence, received_pence FROM financial_lines");

  const byHead: Record<string, ReturnType<typeof sumDistinctHeads>> = {};
  for (const line of lines) {
    const key = line.head_of_loss;
    byHead[key] ??= { claimed: 0, offered: 0, agreed: 0, received: 0 };
    byHead[key].claimed += line.claimed_pence || 0;
    byHead[key].offered += line.offered_pence || 0;
    byHead[key].agreed += line.agreed_pence || 0;
    byHead[key].received += line.received_pence || 0;
  }
  const totals = sumDistinctHeads(lines);

  const cards = [
    { key: "new_enquiries", label: "New enquiries / incomplete forms", count: listClaims({ queue: "new_enquiries" }).length, tone: "warn" },
    { key: "tasks_today", label: "Tasks due today", count: today.length, tone: "info", href: "/tasks?when=today" },
    { key: "tasks_overdue", label: "Overdue tasks", count: overdue.length, tone: "bad", href: "/tasks?when=overdue" },
    { key: "active_hire", label: "Active hire", count: listClaims({ queue: "active_hire" }).length, tone: "info" },
    { key: "storage", label: "Vehicles in storage", count: listClaims({ queue: "storage" }).length, tone: "info" },
    { key: "fleet_available", label: "Fleet available", count: Number(fleetMap.available || 0), tone: "ok", href: "/hire" },
    { key: "liability", label: "Awaited liability responses", count: listClaims({ queue: "liability" }).length, tone: "warn" },
    { key: "engineer", label: "Awaited engineer reports", count: listClaims({ queue: "engineer" }).length, tone: "warn" },
    { key: "repair_auth", label: "Repair authorisations awaited", count: listClaims({ queue: "repair_auth" }).length, tone: "warn" },
    { key: "repairs_progress", label: "Repairs in progress", count: listClaims({ queue: "repairs_progress" }).length, tone: "info" },
    { key: "ready_return", label: "Ready for customer return", count: listClaims({ queue: "ready_return" }).length, tone: "ok" },
    { key: "tl_payment", label: "Total-loss payments awaited", count: listClaims({ queue: "tl_payment" }).length, tone: "warn" },
    { key: "off_hire", label: "Off-hire dates approaching", count: listClaims({ queue: "off_hire" }).length, tone: "warn" },
    { key: "salvage", label: "Salvage awaiting collection", count: listClaims({ queue: "salvage" }).length, tone: "info" },
    { key: "renewals", label: "Agreement renewals (day 80 / unsigned)", count: listClaims({ queue: "renewals" }).length, tone: "bad" },
    { key: "unread", label: "Unread correspondence", count: listClaims({ queue: "unread" }).length, tone: "info" },
    { key: "offers", label: "Offers awaiting review", count: listClaims({ queue: "offers" }).length, tone: "warn" },
    { key: "litigation", label: "Litigation deadlines", count: listClaims({ queue: "litigation" }).length, tone: "bad" },
  ];

  return {
    cards,
    claims,
    today,
    overdue,
    byHandler,
    fleetMap,
    byHead,
    totals,
    headLabels: HEAD_LABELS as Record<string, string>,
  };
}

export function getClaim(idOrRef: string) {
  const claim = get<Record<string, string | number | null>>(
    `SELECT c.*, s.name AS handler_name, p.full_name AS client_name, p.kind AS client_kind,
            p.title AS client_title, p.forename AS client_forename, p.surname AS client_surname,
            p.address_line1, p.town, p.postcode, p.telephone, p.email, p.preferred_channel, p.date_of_birth,
            p.licence_number, p.mobile_tel, p.home_tel,
            v.registration, v.make, v.model, v.transmission, v.fuel, v.body_type, v.seats, v.colour,
            v.lookup_source, v.lookup_incomplete, v.provenance, v.tax_status, v.mot_status, v.insurance_recorded,
            v.details_match_client
     FROM claims c
     LEFT JOIN staff s ON s.id = c.handler_id
     LEFT JOIN people p ON p.id = c.client_person_id
     LEFT JOIN vehicles v ON v.id = c.client_vehicle_id
     WHERE c.id = ? OR c.file_reference = ?`,
    [idOrRef, idOrRef],
  );
  if (!claim) return null;
  const parties = all<Record<string, string | number | null>>(
    `SELECT cp.role, cp.is_primary, pe.*
     FROM claim_parties cp JOIN people pe ON pe.id = cp.person_id
     WHERE cp.claim_id = ? ORDER BY cp.role`,
    [claim.id],
  );
  const thirdParties = all<Record<string, string | number | null>>(
    `SELECT tp.*, pe.full_name, pe.title, pe.forename, pe.surname, pe.address_line1, pe.town, pe.postcode, pe.telephone,
            pe.mobile_tel, pe.email,
            v.registration AS tp_registration, v.make AS tp_make, v.model AS tp_model, v.transmission AS tp_transmission,
            v.colour AS tp_colour, v.fuel AS tp_fuel, v.tax_status AS tp_tax_status, v.mot_status AS tp_mot_status
     FROM claim_third_parties tp
     JOIN people pe ON pe.id = tp.person_id
     LEFT JOIN vehicles v ON v.id = tp.vehicle_id
     WHERE tp.claim_id = ? ORDER BY tp.sequence, tp.id`,
    [claim.id],
  );
  const notes = all<Record<string, string>>(
    `SELECT n.*, s.name AS author_name FROM notes n JOIN staff s ON s.id = n.author_id
     WHERE n.claim_id = ? ORDER BY n.created_at DESC`,
    [claim.id],
  );
  const tasks = all<Record<string, string | number | null>>(
    `SELECT t.*, s.name AS handler_name FROM tasks t LEFT JOIN staff s ON s.id = t.handler_id
     WHERE t.claim_id = ? ORDER BY t.due_at`,
    [claim.id],
  );
  const financials = all<Record<string, string | number | null>>(
    `SELECT * FROM financial_lines WHERE claim_id = ?`,
    [claim.id],
  );
  const hire = all<Record<string, string | number | null>>(
    `SELECT he.*, v.registration, v.make, v.model, v.transmission
     FROM hire_episodes he
     LEFT JOIN fleet_vehicles fv ON fv.id = he.fleet_vehicle_id
     LEFT JOIN vehicles v ON v.id = fv.vehicle_id
     WHERE he.claim_id = ?`,
    [claim.id],
  );
  const agreements = all<Record<string, string | number | null>>(
    `SELECT a.* FROM agreements a
     JOIN hire_episodes he ON he.id = a.hire_episode_id
     WHERE he.claim_id = ? ORDER BY a.sequence`,
    [claim.id],
  );
  const reservations = all<Record<string, string | number | null>>(
    `SELECT r.*, v.registration, v.make, v.model
     FROM reservations r
     JOIN fleet_vehicles fv ON fv.id = r.fleet_vehicle_id
     JOIN vehicles v ON v.id = fv.vehicle_id
     WHERE r.claim_id = ?`,
    [claim.id],
  );
  const correspondence = all<Record<string, string | number | null>>(
    `SELECT * FROM correspondence WHERE claim_id = ? ORDER BY created_at DESC`,
    [claim.id],
  );
  const documents = all<Record<string, string | number | null>>(
    `SELECT * FROM documents WHERE claim_id = ?`,
    [claim.id],
  );
  const automations = all<Record<string, string | number | null>>(
    `SELECT * FROM automations WHERE claim_id = ?`,
    [claim.id],
  );
  const litigation = all<Record<string, string | number | null>>(
    `SELECT * FROM litigation WHERE claim_id = ?`,
    [claim.id],
  );
  const mid = all<Record<string, string | number | null>>(
    `SELECT m.*, s.name AS checker_name FROM mid_lookups m LEFT JOIN staff s ON s.id = m.checker_id WHERE m.claim_id = ?`,
    [claim.id],
  );
  const witnesses = all<Record<string, string | number | null>>(
    `SELECT * FROM claim_witnesses WHERE claim_id = ?`,
    [claim.id],
  );
  const recoveryJobs = all<Record<string, string | number | null>>(
    `SELECT * FROM recovery_jobs WHERE claim_id = ?`,
    [claim.id],
  );
  const compliance = all<Record<string, string | number | null>>(
    `SELECT * FROM vehicle_compliance_checks WHERE claim_id = ? ORDER BY checked_at DESC`,
    [claim.id],
  );
  const events = listClaimEvents(String(claim.id));
  const dates = latestDates(events);
  if (claim.accident_at) dates.accident = String(claim.accident_at);
  const keyDates = KEY_DATE_TYPES.map((type) => ({
    type,
    label: eventLabel(type),
    at: dates[type] || null,
  }));
  return {
    claim,
    parties,
    thirdParties,
    notes,
    tasks,
    financials,
    hire,
    agreements,
    reservations,
    correspondence,
    documents,
    automations,
    litigation,
    mid,
    witnesses,
    recoveryJobs,
    compliance,
    events,
    keyDates,
    money: sumDistinctHeads(financials as never),
  };
}

export function listStaff() {
  return all<{ id: string; name: string; email: string; role: string; username: string | null }>(
    "SELECT id, name, email, role, username FROM staff WHERE active = 1 ORDER BY name",
  );
}

export function listTasks(when?: string) {
  const rows = all<Record<string, string | number | null>>(`
    SELECT t.*, s.name AS handler_name, c.file_reference, p.full_name AS client_name
    FROM tasks t
    LEFT JOIN staff s ON s.id = t.handler_id
    LEFT JOIN claims c ON c.id = t.claim_id
    LEFT JOIN people p ON p.id = c.client_person_id
    WHERE t.status = 'open'
    ORDER BY t.due_at ASC
  `);
  if (when === "today") return rows.filter((t) => t.due_at && isSameLondonDay(String(t.due_at)));
  if (when === "overdue") return rows.filter((t) => t.due_at && isBeforeLondonDay(String(t.due_at)));
  return rows;
}

export function listFleet() {
  return all<Record<string, string | number | null>>(`
    SELECT fv.*, v.registration, v.make, v.model, v.transmission, v.seats, v.body_type, v.fuel
    FROM fleet_vehicles fv JOIN vehicles v ON v.id = fv.vehicle_id
    ORDER BY v.registration
  `);
}

export function listReservations() {
  return all<Record<string, string | number | null>>(`
    SELECT r.*, v.registration, v.make, v.model, c.file_reference
    FROM reservations r
    JOIN fleet_vehicles fv ON fv.id = r.fleet_vehicle_id
    JOIN vehicles v ON v.id = fv.vehicle_id
    LEFT JOIN claims c ON c.id = r.claim_id
    WHERE r.status IN ('reserved','active')
    ORDER BY r.start_at
  `);
}

export function listFinancials() {
  const lines = all<Record<string, string | number | null>>(`
    SELECT f.*, c.file_reference, p.full_name AS client_name
    FROM financial_lines f
    JOIN claims c ON c.id = f.claim_id
    LEFT JOIN people p ON p.id = c.client_person_id
    ORDER BY c.file_reference, f.head_of_loss
  `);
  return { lines, totals: sumDistinctHeads(lines as never), formatGbp };
}

export function listCorrespondence() {
  return all<Record<string, string | number | null>>(`
    SELECT co.*, c.file_reference FROM correspondence co
    JOIN claims c ON c.id = co.claim_id
    ORDER BY co.created_at DESC
  `);
}

export function listDocuments() {
  return all<Record<string, string | number | null>>(`
    SELECT d.*, c.file_reference FROM documents d
    JOIN claims c ON c.id = d.claim_id
    ORDER BY d.created_at DESC
  `);
}

export function listAutomations() {
  return all<Record<string, string | number | null>>(`
    SELECT a.*, c.file_reference FROM automations a
    LEFT JOIN claims c ON c.id = a.claim_id
    ORDER BY a.next_run_at
  `);
}

export function listLitigation() {
  return all<Record<string, string | number | null>>(`
    SELECT l.*, c.file_reference, p.full_name AS client_name
    FROM litigation l
    JOIN claims c ON c.id = l.claim_id
    LEFT JOIN people p ON p.id = c.client_person_id
    ORDER BY l.deadline_on
  `);
}

export function getSettings() {
  const rows = all<{ key: string; value: string }>("SELECT key, value FROM settings");
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function nextReference(): string {
  const prefix = getSettings().file_prefix || FILE_REFERENCE_PREFIX_DEFAULT;
  const refs = all<{ file_reference: string }>("SELECT file_reference FROM claims");
  const max = refs.reduce((m, r) => Math.max(m, parseFileReferenceNumber(r.file_reference, prefix)), 0);
  return nextFileReference(prefix, max);
}

export function createClaimFromForm(input: {
  clientName: string;
  telephone?: string;
  email?: string;
  accidentAt?: string;
  location?: string;
  circumstances?: string;
  claimType: string;
  roadworthiness: string;
  handlerId?: string;
  registration?: string;
}) {
  if (input.accidentAt) {
    const accidentDay = londonDateIso(new Date(input.accidentAt));
    const blocked = accidentDateError(accidentDay);
    if (blocked) throw new Error(blocked);
  }
  const id = newId("claim");
  const personId = newId("person");
  const vehicleId = newId("veh");
  const now = nowUtcIso();
  const ref = nextReference();
  run(
    `INSERT INTO people(id, kind, full_name, telephone, email, preferred_channel, created_at)
     VALUES (?, 'individual', ?, ?, ?, 'phone', ?)`,
    [personId, input.clientName, input.telephone || "Unknown", input.email || null, now],
  );
  run(
    `INSERT INTO vehicles(id, usage, registration, make, model, transmission, lookup_source, lookup_incomplete, provenance)
     VALUES (?, 'client', ?, 'Unknown', 'Unknown', 'unknown', 'manual', 1, 'staff')`,
    [vehicleId, input.registration || "Unknown"],
  );
  run(
    `INSERT INTO claims(
      id, file_reference, created_at, updated_at, accident_at, accident_location, circumstances,
      claim_type, cas_liability_assessment, insurer_liability_position, roadworthiness, current_position,
      handler_id, next_action, next_action_due, client_person_id, client_vehicle_id,
      incomplete_client_submission, is_new_enquiry, repair_status, engineering_status, hire_status,
      recovery_status, storage_status, salvage_status, total_loss, payment_qualifies_off_hire,
      repairs_complete, repaired_vehicle_returned, client_form_status, later_declared_total_loss, replacement_need_review
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unknown', 'pending', ?, ?, ?, 'Review new file and complete missing facts', ?, ?, ?, 1, 1, 'not_applicable', 'not_instructed', 'none', 'none', 'none', 'none', 0, 0, 0, 0, 'in_progress', 0, 0)`,
    [
      id, ref, now, now, input.accidentAt || null, input.location || "Unknown",
      input.circumstances || "Unknown", input.claimType, input.roadworthiness,
      "New enquiry — awaiting completion", input.handlerId || null, now, personId, vehicleId,
    ],
  );
  run(`INSERT INTO claim_parties(id, claim_id, person_id, role, is_primary) VALUES (?, ?, ?, 'client', 1)`, [
    newId("party"), id, personId,
  ]);
  run(`INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details) VALUES (?, ?, ?, 'create', 'claim', ?, ?)`, [
    newId("audit"), now, input.handlerId || "staff-sian", id, `Created ${ref}`,
  ]);
  recordClaimEvent({
    claimId: id,
    eventType: "file_opened",
    occurredAt: now,
    details: `File ${ref} opened.`,
    actorId: input.handlerId || "staff-sian",
    channel: "system",
    source: "system",
  });
  if (input.accidentAt) {
    recordClaimEvent({
      claimId: id,
      eventType: "accident",
      occurredAt: input.accidentAt,
      details: input.location || "Unknown",
      actorId: input.handlerId || "staff-sian",
      source: "staff",
    });
  }
  return { id, fileReference: ref };
}

export function addNote(claimId: string, authorId: string, body: string) {
  run(`INSERT INTO notes(id, claim_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)`, [
    newId("note"), claimId, authorId, body, nowUtcIso(),
  ]);
  run(`UPDATE claims SET updated_at = ? WHERE id = ?`, [nowUtcIso(), claimId]);
}

export function addTask(input: {
  claimId: string;
  handlerId: string;
  title: string;
  details?: string;
  type: string;
  dueAt?: string;
}) {
  run(
    `INSERT INTO tasks(id, claim_id, handler_id, title, details, type, due_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    [newId("task"), input.claimId, input.handlerId, input.title, input.details || null, input.type, input.dueAt || null, nowUtcIso()],
  );
}

export function completeTask(id: string) {
  run(`UPDATE tasks SET status = 'done' WHERE id = ?`, [id]);
}

export function updateClaimPosition(id: string, fields: Record<string, string>) {
  const allowed = [
    "current_position", "circumstances", "accident_location", "claim_type", "cas_liability_assessment",
    "insurer_liability_position", "roadworthiness", "roadworthiness_reasons", "next_action", "next_action_due",
    "handler_id", "own_insurer_name", "own_policy_ref", "own_claim_ref",
  ];
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [nowUtcIso()];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) {
      sets.push(`${k} = ?`);
      params.push(v);
    }
  }
  params.push(id);
  run(`UPDATE claims SET ${sets.join(", ")} WHERE id = ?`, params);
}

export function createReservation(input: {
  fleetVehicleId: string;
  claimId?: string;
  startAt: string;
  endAt: string;
  kind: string;
  createdBy: string;
}) {
  const existing = listReservations().map((r) => ({
    vehicleId: String(r.fleet_vehicle_id),
    startAt: String(r.start_at),
    endAt: String(r.end_at),
    status: String(r.status),
  }));
  const decision = canReserveVehicle({
    vehicleId: input.fleetVehicleId,
    startAt: input.startAt,
    endAt: input.endAt,
    existing,
  });
  if (!decision.ok) throw new Error(decision.reason);
  run(
    `INSERT INTO reservations(id, fleet_vehicle_id, claim_id, start_at, end_at, kind, status, charges_started, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'reserved', 0, ?, ?)`,
    [newId("res"), input.fleetVehicleId, input.claimId || null, input.startAt, input.endAt, input.kind, input.createdBy, nowUtcIso()],
  );
  run(`UPDATE fleet_vehicles SET status = 'reserved' WHERE id = ? AND status = 'available'`, [input.fleetVehicleId]);
}

export function dbLocation() {
  return dbPath();
}

export function moneyByHeadLabel(head: string) {
  return (HEAD_LABELS as Record<string, string>)[head as HeadOfLoss] || head;
}

export { londonDateIso, formatGbp };
