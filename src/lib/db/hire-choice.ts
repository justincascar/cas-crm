import { AGREEMENT_ALERT_FROM_DAY, AGREEMENT_LENGTH_DAYS, AGREEMENT_OVERDUE_DAY } from "../constants";
import { formatGbp } from "../money";
import { formatUkDate, londonDateIso, londonTodayIso, nowUtcIso, requireLondonDateTime, toLondonDateTimeLocal } from "../dates";
import { standardDailyRatePence } from "../documents/gta";
import {
  agreementHoldEndDay,
  hireClashMessage,
  hireDaysOverlap,
  parseHireNeed,
  suitableHireCars,
  type HireCar,
  type HireNeed,
  type HireOccupation,
} from "../domain/hire-availability";
import { agreementDayNumber } from "../domain/rules";
import { canDoFieldJob } from "../auth/roles";
import { getHirePack } from "./hire-pack";
import { getGtaMarkupPercent } from "./hire-agreement";
import { hireAgreementPrehireBlock, listHireGaps } from "./prehire-checks";
import { licenceCheckWindowDays } from "./licence-window";
import { recordVehicleHandover } from "./handover";
import { activeReservationFor, startHireFromHandover } from "./hire-start";
import { recordClaimEvent } from "./chronology";
import { touchFleetVersion } from "./fleet";
import { all, get, newId, run } from "./connection";
import { withImmediateTransaction, sectionVersion } from "./record-version";
import { replaySubmit, storeSubmit } from "./submit-key";

export type HireCarChoice = HireCar & { label: string; version: string };

export type HireArea = {
  claimId: string;
  fileReference: string;
  claimType: string;
  creditHire: boolean;
  clientName: string;
  telephone: string;
  email: string;
  address: string;
  licenceNumber: string;
  need: HireNeed;
  needReason: string;
  checksDone: boolean;
  gaps: Array<{ key: string; kind: string; label: string; href: string }>;
  agreementCount: number;
  windowDays: number;
  chosen: {
    fleetVehicleId: string;
    episodeId: string;
    label: string;
    registration: string;
    reservationId: string | null;
  } | null;
  startedAt: string | null;
  dayCount: number | null;
  renewal: string | null;
  ratePence: number | null;
  cars: HireCarChoice[];
  delivery: { method: "deliver" | "collect"; date: string; time: string; address: string; jobId: string | null } | null;
  collectionJobId: string | null;
  handoverId: string | null;
  packMissing: string[];
  next: { label: string; href: string };
  heldElsewhere: string | null;
};

function once<T>(key: string, work: () => T): T {
  const replay = replaySubmit<T>(key);
  if (replay) return replay;
  return withImmediateTransaction(() => {
    const again = replaySubmit<T>(key);
    if (again) return again;
    const value = work();
    storeSubmit(key, value);
    return value;
  });
}

function claimRow(claimId: string) {
  return get<{
    id: string;
    file_reference: string;
    claim_type: string;
    client_name: string | null;
    telephone: string | null;
    email: string | null;
    address_line1: string | null;
    town: string | null;
    postcode: string | null;
    licence_number: string | null;
    transmission: string | null;
    seats: number | null;
    vehicle_class: string | null;
    gta_group: string | null;
    registration: string | null;
  }>(
    `SELECT c.id, c.file_reference, c.claim_type, p.full_name AS client_name, p.telephone, p.email,
            p.address_line1, p.town, p.postcode, p.licence_number,
            v.transmission, v.seats, v.vehicle_class, v.gta_group, v.registration
     FROM claims c
     LEFT JOIN people p ON p.id = c.client_person_id
     LEFT JOIN vehicles v ON v.id = c.client_vehicle_id
     WHERE c.id = ?`,
    [claimId],
  );
}

function occupations(): HireOccupation[] {
  const reservations = all<{
    fleet_vehicle_id: string;
    claim_id: string | null;
    file_reference: string | null;
    start_at: string;
    end_at: string;
    status: string;
  }>(
    `SELECT r.fleet_vehicle_id, r.claim_id, c.file_reference, r.start_at, r.end_at, r.status
     FROM reservations r
     LEFT JOIN claims c ON c.id = r.claim_id
     WHERE r.status IN ('reserved', 'active')`,
  );
  const episodes = all<{
    fleet_vehicle_id: string;
    claim_id: string;
    file_reference: string | null;
    started_at: string;
  }>(
    `SELECT he.fleet_vehicle_id, he.claim_id, c.file_reference, he.started_at
     FROM hire_episodes he
     JOIN claims c ON c.id = he.claim_id
     WHERE he.fleet_vehicle_id IS NOT NULL
       AND he.started_at IS NOT NULL
       AND he.billing_end_at IS NULL
       AND he.collection_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM reservations r
         WHERE r.fleet_vehicle_id = he.fleet_vehicle_id
           AND r.claim_id = he.claim_id
           AND r.status IN ('reserved', 'active')
       )`,
  );
  return [
    ...reservations.map((row) => ({
      fleetVehicleId: String(row.fleet_vehicle_id),
      claimId: row.claim_id ? String(row.claim_id) : null,
      fileReference: row.file_reference ? String(row.file_reference) : null,
      startAt: String(row.start_at),
      endAt: String(row.end_at),
      status: String(row.status) === "active" ? "active" : "reserved",
    })),
    ...episodes.map((row) => ({
      fleetVehicleId: String(row.fleet_vehicle_id),
      claimId: String(row.claim_id),
      fileReference: row.file_reference ? String(row.file_reference) : null,
      startAt: String(row.started_at),
      endAt: "9999-12-31",
      status: "on_hire",
    })),
  ];
}

function fleetCars(): HireCar[] {
  return all<{
    id: string;
    status: string;
    removed_at: string | null;
    registration: string | null;
    make: string | null;
    model: string | null;
    transmission: string | null;
    seats: number | null;
    vehicle_class: string | null;
  }>(
    `SELECT fv.id, fv.status, fv.removed_at, v.registration, v.make, v.model, v.transmission, v.seats, v.vehicle_class
     FROM fleet_vehicles fv
     JOIN vehicles v ON v.id = fv.vehicle_id
     WHERE fv.removed_at IS NULL`,
  ).map((row) => ({
    id: String(row.id),
    registration: String(row.registration || ""),
    make: String(row.make || ""),
    model: String(row.model || ""),
    transmission: String(row.transmission || ""),
    seats: row.seats == null ? null : Number(row.seats),
    vehicleClass: String(row.vehicle_class || ""),
    status: String(row.status || ""),
    removed: Boolean(row.removed_at),
  }));
}

function clashReference(fleetVehicleId: string, claimId: string, startAt: string, endAt: string): string | null {
  const hit = occupations().find(
    (span) =>
      span.fleetVehicleId === fleetVehicleId &&
      span.claimId !== claimId &&
      ["reserved", "active", "on_hire"].includes(span.status) &&
      hireDaysOverlap(startAt, endAt, span.startAt, span.endAt),
  );
  if (!hit) return null;
  return hit.fileReference || "a staff booking";
}

function deliveryClock(date: string, time: string): { at: string; day: string; endDay: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Enter the delivery or collection date.");
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("Enter the time.");
  const at = requireLondonDateTime(`${date}T${time}`);
  return { at, day: date, endDay: agreementHoldEndDay(date) };
}

function driverStaffId(): string {
  const row = get<{ id: string }>(
    `SELECT id FROM staff WHERE active = 1 AND role = 'driver'
     ORDER BY CASE WHEN id = 'staff-driver' THEN 0 ELSE 1 END, name LIMIT 1`,
  );
  if (!row) throw new Error("There is no driver login to assign this delivery to.");
  return String(row.id);
}

function freeFleetIfIdle(fleetVehicleId: string) {
  const held = get<{ id: string }>(
    `SELECT id FROM reservations WHERE fleet_vehicle_id = ? AND status IN ('reserved', 'active') LIMIT 1`,
    [fleetVehicleId],
  );
  const live = get<{ id: string }>(
    `SELECT id FROM hire_episodes
     WHERE fleet_vehicle_id = ? AND started_at IS NOT NULL AND billing_end_at IS NULL AND collection_at IS NULL
     LIMIT 1`,
    [fleetVehicleId],
  );
  if (!held && !live) {
    run(`UPDATE fleet_vehicles SET status = 'available' WHERE id = ? AND status IN ('reserved', 'on_hire')`, [
      fleetVehicleId,
    ]);
  }
}

function cancelOpenJobs(claimId: string, kind: string) {
  run(
    `UPDATE day_assignments SET cancelled_at = ?
     WHERE claim_id = ? AND job_kind = ? AND cancelled_at IS NULL AND completed_at IS NULL`,
    [nowUtcIso(), claimId, kind],
  );
}

function releaseReservations(claimId: string, keepFleetId: string | null) {
  const rows = all<{ id: string; fleet_vehicle_id: string }>(
    `SELECT id, fleet_vehicle_id FROM reservations WHERE claim_id = ? AND status IN ('reserved', 'active')`,
    [claimId],
  );
  for (const row of rows) {
    if (keepFleetId && row.fleet_vehicle_id === keepFleetId) continue;
    run(`UPDATE reservations SET status = 'cancelled' WHERE id = ?`, [row.id]);
  }
}

function snapshotRate(claimId: string): number | null {
  const claim = claimRow(claimId);
  if (!claim) return null;
  return standardDailyRatePence(claim.gta_group, getGtaMarkupPercent());
}

function ensurePackDraft(claimId: string, address: string, ratePence: number | null, actorId: string) {
  const existing = get<{ daily_rate_pence: number | null }>(
    `SELECT daily_rate_pence FROM hire_pack_data WHERE claim_id = ?`,
    [claimId],
  );
  const now = nowUtcIso();
  if (!existing) {
    run(
      `INSERT INTO hire_pack_data(claim_id, delivery_address, daily_rate_pence, updated_at) VALUES (?, ?, ?, ?)`,
      [claimId, address, ratePence, now],
    );
  } else {
    const keepRate = Number(existing.daily_rate_pence || 0) > 0;
    run(
      `UPDATE hire_pack_data
       SET delivery_address = CASE WHEN ? != '' THEN ? ELSE delivery_address END,
           daily_rate_pence = CASE WHEN ? = 1 THEN daily_rate_pence ELSE COALESCE(?, daily_rate_pence) END,
           updated_at = ?
       WHERE claim_id = ?`,
      [address, address, keepRate ? 1 : 0, ratePence, now, claimId],
    );
  }
  const pack = getHirePack(claimId);
  const missing = pack?.missing || [];
  recordClaimEvent({
    claimId,
    eventType: "hire_pack_draft",
    occurredAt: now,
    actorId,
    details:
      missing.length > 0
        ? `Hire pack draft saved. Still missing: ${missing.join(", ")}.`
        : "Hire pack draft saved. The details on the file are filled in.",
    source: "staff",
  });
  return missing;
}

function upsertJob(input: {
  claimId: string;
  episodeId: string;
  kind: "hire_delivery" | "hire_collection";
  workDate: string;
  plannedAt: string;
  place: string;
  actorId: string;
}): string {
  const existing = get<{ id: string }>(
    `SELECT id FROM day_assignments
     WHERE claim_id = ? AND job_kind = ? AND cancelled_at IS NULL AND completed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [input.claimId, input.kind],
  );
  if (existing) {
    run(
      `UPDATE day_assignments
       SET hire_episode_id = ?, work_date = ?, planned_at = ?, place_text = ?, assignee_id = ?
       WHERE id = ?`,
      [input.episodeId, input.workDate, input.plannedAt, input.place, driverStaffId(), existing.id],
    );
    return String(existing.id);
  }
  const id = newId("job");
  run(
    `INSERT INTO day_assignments(
      id, assignee_id, job_kind, claim_id, hire_episode_id, work_date, created_by, created_at, planned_at, place_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      driverStaffId(),
      input.kind,
      input.claimId,
      input.episodeId,
      input.workDate,
      input.actorId,
      nowUtcIso(),
      input.plannedAt,
      input.place,
    ],
  );
  return id;
}

export function saveHireNeed(input: {
  claimId: string;
  choice: "yes" | "not_yet" | "not_needed";
  reason: string;
  actorId: string;
  submitKey: string;
}) {
  return once(input.submitKey, () => {
    const claim = claimRow(input.claimId);
    if (!claim) throw new Error("File not found.");
    const started = get<{ id: string }>(
      `SELECT id FROM hire_episodes WHERE claim_id = ? AND started_at IS NOT NULL LIMIT 1`,
      [input.claimId],
    );
    if (started && input.choice !== "yes") throw new Error("Hire has already started.");
    const reason = input.reason.trim();
    if (input.choice === "not_needed" && !reason) throw new Error("A reason is required when hire is not needed.");
    const details =
      input.choice === "yes"
        ? "Replacement vehicle: yes."
        : input.choice === "not_yet"
          ? "Replacement vehicle: not yet. Client keeps own car for now."
          : `Replacement vehicle: no. Reason: ${reason}`;
    if (input.choice !== "yes") {
      const held = all<{ fleet_vehicle_id: string }>(
        `SELECT fleet_vehicle_id FROM reservations WHERE claim_id = ? AND status IN ('reserved', 'active')
         UNION
         SELECT fleet_vehicle_id FROM hire_episodes
         WHERE claim_id = ? AND started_at IS NULL AND fleet_vehicle_id IS NOT NULL`,
        [input.claimId, input.claimId],
      );
      if (held.length) {
        releaseReservations(input.claimId, null);
        run(`UPDATE hire_episodes SET fleet_vehicle_id = NULL WHERE claim_id = ? AND started_at IS NULL`, [input.claimId]);
        for (const row of held) freeFleetIfIdle(String(row.fleet_vehicle_id));
        cancelOpenJobs(input.claimId, "hire_delivery");
        recordClaimEvent({
          claimId: input.claimId,
          eventType: "hire_vehicle_released",
          occurredAt: nowUtcIso(),
          actorId: input.actorId,
          details: "The hire car reservation was released. Hire charges were not started.",
          source: "staff",
        });
      }
    }
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "hire_decision",
      occurredAt: nowUtcIso(),
      actorId: input.actorId,
      details,
      source: "staff",
    });
    return { ok: true as const };
  });
}

export function chooseHireCar(input: {
  claimId: string;
  fleetVehicleId: string;
  method: "deliver" | "collect";
  date: string;
  time: string;
  address: string;
  actorId: string;
  submitKey: string;
  expectedVersion?: string;
}) {
  return once(input.submitKey, () => {
    const claim = claimRow(input.claimId);
    if (!claim) throw new Error("File not found.");
    const decision = get<{ details: string | null }>(
      `SELECT details FROM claim_events WHERE claim_id = ? AND event_type = 'hire_decision'
       ORDER BY occurred_at DESC, id DESC LIMIT 1`,
      [input.claimId],
    );
    if (parseHireNeed(decision?.details) !== "yes") throw new Error("Say that hire is needed before choosing a car.");
    const clock = deliveryClock(input.date, input.time);
    const endAt = requireLondonDateTime(`${clock.endDay}T23:59`);
    const car = fleetCars().find((item) => item.id === input.fleetVehicleId);
    if (!car) throw new Error("That car is not on the fleet.");
    if (car.status === "maintenance" || car.status === "off_road" || car.status === "sold" || car.removed) {
      throw new Error("That car is not available.");
    }
    const clash = clashReference(input.fleetVehicleId, input.claimId, clock.at, endAt);
    if (clash) throw new Error(hireClashMessage(clash));
    touchFleetVersion({
      fleetVehicleId: input.fleetVehicleId,
      actorId: input.actorId,
      expected: input.expectedVersion,
      change: "Hire car chosen",
    });
    const current = get<{
      id: string;
      fleet_vehicle_id: string | null;
      started_at: string | null;
      rate_pence_per_day: number | null;
      collection_at: string | null;
      billing_end_at: string | null;
    }>(
      `SELECT id, fleet_vehicle_id, started_at, rate_pence_per_day, collection_at, billing_end_at FROM hire_episodes
       WHERE claim_id = ?
       ORDER BY CASE WHEN collection_at IS NULL AND billing_end_at IS NULL THEN 0 ELSE 1 END,
                CASE WHEN started_at IS NULL THEN 0 ELSE 1 END,
                started_at DESC
       LIMIT 1`,
      [input.claimId],
    );
    const openEpisode = current && !current.collection_at && !current.billing_end_at ? current : null;
    const previousFleet = openEpisode?.fleet_vehicle_id ? String(openEpisode.fleet_vehicle_id) : null;
    const creditHire = claim.claim_type === "fault" ? 0 : 1;
    const rate = openEpisode?.started_at ? Number(openEpisode.rate_pence_per_day || 0) || null : snapshotRate(input.claimId);
    let episodeId = "";
    if (!openEpisode) {
      episodeId = newId("he");
      run(
        `INSERT INTO hire_episodes(
          id, claim_id, fleet_vehicle_id, started_at, like_for_like, suitability_reason, credit_hire, rate_pence_per_day
        ) VALUES (?, ?, ?, NULL, 0, '', ?, ?)`,
        [episodeId, input.claimId, input.fleetVehicleId, creditHire, rate],
      );
    } else {
      episodeId = String(openEpisode.id);
      run(
        `UPDATE hire_episodes SET fleet_vehicle_id = ?, credit_hire = ?, rate_pence_per_day = COALESCE(?, rate_pence_per_day) WHERE id = ?`,
        [input.fleetVehicleId, creditHire, openEpisode.started_at ? null : rate, episodeId],
      );
    }
    releaseReservations(input.claimId, input.fleetVehicleId);
    if (previousFleet && previousFleet !== input.fleetVehicleId) freeFleetIfIdle(previousFleet);
    const same = get<{ id: string }>(
      `SELECT id FROM reservations
       WHERE claim_id = ? AND fleet_vehicle_id = ? AND status IN ('reserved', 'active') LIMIT 1`,
      [input.claimId, input.fleetVehicleId],
    );
    let reservationId = same ? String(same.id) : newId("res");
    const kind = creditHire ? "hire" : "courtesy";
    if (same) {
      run(`UPDATE reservations SET start_at = ?, end_at = ?, kind = ?, charges_started = 0 WHERE id = ?`, [
        clock.at,
        endAt,
        kind,
        reservationId,
      ]);
    } else {
      run(
        `INSERT INTO reservations(
          id, fleet_vehicle_id, claim_id, start_at, end_at, kind, status, charges_started, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'reserved', 0, ?, ?)`,
        [reservationId, input.fleetVehicleId, input.claimId, clock.at, endAt, kind, input.actorId, nowUtcIso()],
      );
    }
    const fleetStatus = openEpisode?.started_at ? "on_hire" : "reserved";
    run(`UPDATE fleet_vehicles SET status = ? WHERE id = ?`, [fleetStatus, input.fleetVehicleId]);
    const address = input.address.trim();
    const clientAddress = [claim.address_line1, claim.town, claim.postcode].filter(Boolean).join(", ");
    const place = address || clientAddress;
    let jobId: string | null = null;
    if (input.method === "deliver") {
      jobId = upsertJob({
        claimId: input.claimId,
        episodeId,
        kind: "hire_delivery",
        workDate: clock.day,
        plannedAt: clock.at,
        place,
        actorId: input.actorId,
      });
    } else {
      cancelOpenJobs(input.claimId, "hire_delivery");
    }
    const missing = claim.claim_type === "fault" ? [] : ensurePackDraft(input.claimId, place, rate, input.actorId);
    const label = [car.make, car.model, car.registration].filter(Boolean).join(" ");
    recordClaimEvent({
      claimId: input.claimId,
      eventType: openEpisode?.started_at ? "hire_vehicle_changed" : "hire_vehicle_reserved",
      occurredAt: nowUtcIso(),
      actorId: input.actorId,
      details: openEpisode?.started_at
        ? `Hire car changed to ${label}. The hire start date was not changed. Charges follow the original handover.`
        : `Reserved ${label} for ${input.method === "deliver" ? "delivery" : "client collection"} on ${formatUkDate(clock.day)}. A reservation does not start hire charges.${missing.length ? ` Pack draft still missing: ${missing.join(", ")}.` : ""}`,
      source: "staff",
    });
    return { reservationId, episodeId, jobId, missing };
  });
}

export function cancelHireCar(input: { claimId: string; actorId: string; submitKey: string }) {
  return once(input.submitKey, () => {
    const started = get<{ id: string }>(
      `SELECT id FROM hire_episodes WHERE claim_id = ? AND started_at IS NOT NULL AND billing_end_at IS NULL AND collection_at IS NULL LIMIT 1`,
      [input.claimId],
    );
    if (started) throw new Error("Hire has started. Collection ends it after a handler confirms the hire car is back.");
    const fleets = all<{ fleet_vehicle_id: string }>(
      `SELECT fleet_vehicle_id FROM reservations WHERE claim_id = ? AND status IN ('reserved', 'active')`,
      [input.claimId],
    );
    releaseReservations(input.claimId, null);
    run(`UPDATE hire_episodes SET fleet_vehicle_id = NULL WHERE claim_id = ? AND started_at IS NULL`, [input.claimId]);
    for (const row of fleets) freeFleetIfIdle(String(row.fleet_vehicle_id));
    cancelOpenJobs(input.claimId, "hire_delivery");
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "hire_vehicle_released",
      occurredAt: nowUtcIso(),
      actorId: input.actorId,
      details: "The reservation was cancelled. Hire charges were not started.",
      source: "staff",
    });
    return { ok: true as const };
  });
}

export function completeHireHandover(input: {
  claimId: string;
  mileage: number;
  fuelLevel: string;
  driverId: string;
  date: string;
  time: string;
  actorId: string;
  submitKey: string;
  conditionNote?: string;
}) {
  return once(input.submitKey, () => {
    if (!activeReservationFor(input.claimId)) {
      const started = get<{ started_at: string | null }>(
        `SELECT started_at FROM hire_episodes WHERE claim_id = ? AND started_at IS NOT NULL LIMIT 1`,
        [input.claimId],
      );
      if (!started?.started_at) throw new Error("Choose a car before the handover. Use Choose a car on the Hire tab.");
    }
    const clock = deliveryClock(input.date, input.time);
    const driver = get<{ id: string; role: string }>(`SELECT id, role FROM staff WHERE id = ? AND active = 1`, [
      input.driverId,
    ]);
    if (!driver || !canDoFieldJob(driver.role)) throw new Error("Choose the person who handed the car over.");
    const episode = get<{ id: string }>(
      `SELECT id FROM hire_episodes WHERE claim_id = ? AND fleet_vehicle_id IS NOT NULL
       ORDER BY CASE WHEN started_at IS NULL THEN 0 ELSE 1 END LIMIT 1`,
      [input.claimId],
    );
    if (!episode) throw new Error("Choose a car before the handover. Use Choose a car on the Hire tab.");
    const blocked = hireAgreementPrehireBlock(input.claimId, { asAtYmd: clock.day, purpose: "handover" });
    if (blocked) throw new Error(blocked);
    const saved = recordVehicleHandover({
      claimId: input.claimId,
      eventKind: "hire_delivered",
      hireEpisodeId: String(episode.id),
      mileage: String(input.mileage),
      fuelLevel: input.fuelLevel,
      conditionNote: input.conditionNote || "",
      actorId: input.actorId,
      photos: [],
      actualDriverId: input.driverId,
      actualOccurredAt: clock.at,
      deferCommit: true,
    });
    const started = startHireFromHandover({
      claimId: input.claimId,
      occurredAt: clock.at,
      actorId: input.actorId,
      hireEpisodeId: String(episode.id),
    });
    return { handoverId: saved.id, startedAt: started.startedAt, already: started.already };
  });
}

export function arrangeHireCollection(input: {
  claimId: string;
  date: string;
  time: string;
  address: string;
  actorId: string;
  submitKey: string;
}) {
  return once(input.submitKey, () => {
    const episode = get<{ id: string; started_at: string | null }>(
      `SELECT id, started_at FROM hire_episodes
       WHERE claim_id = ? AND started_at IS NOT NULL AND billing_end_at IS NULL AND collection_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
      [input.claimId],
    );
    if (!episode?.started_at) throw new Error("Hire has not started, so there is no collection to arrange.");
    const clock = deliveryClock(input.date, input.time);
    const claim = claimRow(input.claimId);
    const place =
      input.address.trim() ||
      [claim?.address_line1, claim?.town, claim?.postcode].filter(Boolean).join(", ");
    const jobId = upsertJob({
      claimId: input.claimId,
      episodeId: String(episode.id),
      kind: "hire_collection",
      workDate: clock.day,
      plannedAt: clock.at,
      place,
      actorId: input.actorId,
    });
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "hire_collection_arranged",
      occurredAt: nowUtcIso(),
      actorId: input.actorId,
      details: `Collection arranged for ${formatUkDate(clock.day)}. This does not end hire charges. Hire ends when the collection is confirmed by a handler.`,
      source: "staff",
    });
    return { jobId };
  });
}

function renewalLine(startedAt: string | null, creditHire: boolean): { dayCount: number | null; renewal: string | null } {
  if (!startedAt) return { dayCount: null, renewal: null };
  const startDay = londonDateIso(new Date(startedAt));
  const dayCount = agreementDayNumber(startDay, londonTodayIso());
  if (!creditHire) {
    return {
      dayCount,
      renewal: "Courtesy car. There is no daily charge to an insurer.",
    };
  }
  let renewal = `Day ${dayCount} from the handover on ${formatUkDate(startDay)}. The count does not restart when the agreement is renewed.`;
  if (dayCount >= AGREEMENT_OVERDUE_DAY) {
    renewal = `Overdue. Day ${dayCount}. Alerts are overdue from day ${AGREEMENT_OVERDUE_DAY}. The agreement is ${AGREEMENT_LENGTH_DAYS} days. The count does not restart when a renewal is logged.`;
  } else if (dayCount >= AGREEMENT_ALERT_FROM_DAY) {
    renewal = `Renewal alert. Day ${dayCount}. Alerts start on day ${AGREEMENT_ALERT_FROM_DAY} and are overdue on day ${AGREEMENT_OVERDUE_DAY}. The agreement is ${AGREEMENT_LENGTH_DAYS} days.`;
  }
  return { dayCount, renewal };
}

export function loadHireArea(
  claimId: string,
  filters: { date?: string; transmission?: string; vehicleClass?: string; seats?: string } = {},
): HireArea | null {
  const claim = claimRow(claimId);
  if (!claim) return null;
  const decision = get<{ details: string | null }>(
    `SELECT details FROM claim_events WHERE claim_id = ? AND event_type = 'hire_decision'
     ORDER BY occurred_at DESC, id DESC LIMIT 1`,
    [claimId],
  );
  const need = parseHireNeed(decision?.details);
  const creditHire = claim.claim_type !== "fault";
  const gaps = need === "yes" ? listHireGaps(claimId) : [];
  const episode = get<{
    id: string;
    fleet_vehicle_id: string | null;
    started_at: string | null;
    rate_pence_per_day: number | null;
    registration: string | null;
    make: string | null;
    model: string | null;
  }>(
    `SELECT he.id, he.fleet_vehicle_id, he.started_at, he.rate_pence_per_day,
            v.registration, v.make, v.model
     FROM hire_episodes he
     LEFT JOIN fleet_vehicles fv ON fv.id = he.fleet_vehicle_id
     LEFT JOIN vehicles v ON v.id = fv.vehicle_id
     WHERE he.claim_id = ? AND he.fleet_vehicle_id IS NOT NULL
     ORDER BY CASE WHEN he.collection_at IS NULL AND he.billing_end_at IS NULL THEN 0 ELSE 1 END,
              CASE WHEN he.started_at IS NULL THEN 0 ELSE 1 END,
              he.started_at DESC
     LIMIT 1`,
    [claimId],
  );
  const reservation = activeReservationFor(claimId);
  const date = filters.date && /^\d{4}-\d{2}-\d{2}$/.test(filters.date) ? filters.date : londonTodayIso();
  const endDay = agreementHoldEndDay(date);
  const seats = filters.seats && /^\d+$/.test(filters.seats) ? Number(filters.seats) : null;
  const cars = suitableHireCars({
    cars: fleetCars(),
    occupied: occupations(),
    startAt: date,
    endAt: endDay,
    ignoreClaimId: claimId,
    client: {
      transmission: claim.transmission,
      seats: claim.seats == null ? null : Number(claim.seats),
      vehicleClass: claim.vehicle_class,
    },
    transmission: filters.transmission || "",
    vehicleClass: filters.vehicleClass || "",
    minSeats: seats,
  }).map((car) => ({
    ...car,
    label: [car.make, car.model, car.registration].filter(Boolean).join(" "),
    version: sectionVersion("fleet", car.id),
  }));
  const address = [claim.address_line1, claim.town, claim.postcode].filter(Boolean).join(", ");
  const deliveryJob = get<{ id: string; work_date: string; planned_at: string | null; place_text: string | null }>(
    `SELECT id, work_date, planned_at, place_text FROM day_assignments
     WHERE claim_id = ? AND job_kind = 'hire_delivery' AND cancelled_at IS NULL AND completed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [claimId],
  );
  const collection = get<{ id: string }>(
    `SELECT id FROM day_assignments
     WHERE claim_id = ? AND job_kind = 'hire_collection' AND cancelled_at IS NULL AND completed_at IS NULL
     LIMIT 1`,
    [claimId],
  );
  const handover = get<{ id: string }>(
    `SELECT id FROM vehicle_handovers WHERE claim_id = ? AND event_kind = 'hire_delivered' ORDER BY occurred_at DESC LIMIT 1`,
    [claimId],
  );
  const pack = creditHire ? getHirePack(claimId) : null;
  const count = renewalLine(episode?.started_at ? String(episode.started_at) : null, creditHire);
  const chosen = episode?.fleet_vehicle_id
    ? {
        fleetVehicleId: String(episode.fleet_vehicle_id),
        episodeId: String(episode.id),
        label: [episode.make, episode.model, episode.registration].filter(Boolean).join(" "),
        registration: String(episode.registration || ""),
        reservationId: reservation ? String(reservation.id) : null,
      }
    : null;
  const agreementCount = Number(
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM documents WHERE claim_id = ? AND template_key = 'hire_agreement'`,
      [claimId],
    )?.n || 0,
  );
  const base = `/claims/${claimId}/hire`;
  let next = { label: "Hire needed?", href: `${base}#need` };
  if (need === "no") next = { label: "Hire not needed", href: `${base}#need` };
  else if (!need || need === "not_yet") next = { label: "Hire needed?", href: `${base}#need` };
  else if (!chosen) next = { label: "Choose a car", href: `${base}#car` };
  else if (gaps.length) next = { label: "Pre-hire checks", href: `${base}#checks` };
  else if (creditHire && agreementCount === 0 && !episode?.started_at) next = { label: "Hire pack", href: `${base}#pack` };
  else if (!episode?.started_at) next = { label: "Handover", href: `${base}#handover` };
  else next = { label: "On hire", href: `${base}#on-hire` };
  const planned = deliveryJob?.planned_at ? toLondonDateTimeLocal(String(deliveryJob.planned_at)) : "";
  return {
    claimId,
    fileReference: String(claim.file_reference),
    claimType: String(claim.claim_type),
    creditHire,
    clientName: String(claim.client_name || ""),
    telephone: String(claim.telephone || ""),
    email: String(claim.email || ""),
    address,
    licenceNumber: String(claim.licence_number || ""),
    need,
    needReason: decision?.details?.match(/Reason:\s*(.+)$/i)?.[1]?.trim() || "",
    checksDone: gaps.length === 0,
    gaps,
    agreementCount,
    windowDays: licenceCheckWindowDays(),
    chosen,
    startedAt: episode?.started_at ? String(episode.started_at) : null,
    dayCount: count.dayCount,
    renewal: count.renewal,
    ratePence: episode?.rate_pence_per_day ? Number(episode.rate_pence_per_day) : null,
    cars,
    delivery: deliveryJob
      ? {
          method: "deliver",
          date: String(deliveryJob.work_date),
          time: planned.length >= 16 ? planned.slice(11, 16) : "",
          address: String(deliveryJob.place_text || address),
          jobId: String(deliveryJob.id),
        }
      : chosen
        ? { method: "collect", date, time: "", address, jobId: null }
        : null,
    collectionJobId: collection ? String(collection.id) : null,
    handoverId: handover ? String(handover.id) : null,
    packMissing: pack?.missing ? [...pack.missing] : [],
    next,
    heldElsewhere: null,
  };
}

export function ratePreview(claimId: string): string {
  const rate = snapshotRate(claimId);
  return rate ? `${formatGbp(rate)} a day from Settings for this client's group` : "No group rate on Settings for this client's vehicle yet";
}

export { AGREEMENT_LENGTH_DAYS };
