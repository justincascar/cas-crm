import { AGREEMENT_ALERT_FROM_DAY, AGREEMENT_LENGTH_DAYS, AGREEMENT_OVERDUE_DAY } from "../constants";
import { formatGbp } from "../money";
import { formatUkDate, formatUkDateTime, londonDateIso, londonTodayIso, nowUtcIso, requireLondonDateTime, toLondonDateTimeLocal } from "../dates";
import { normaliseGtaGroup } from "../documents/gta";
import { settingsDailyRatePence, settingsGtaGroup, settingsGtaGroups } from "./gta-rates";
import { agreementHoldEndDay, parseHireNeed, type HireNeed } from "../domain/hire-availability";
import { carNotFreeMessage } from "../domain/fleet-availability";
import { agreementDayNumber } from "../domain/rules";
import { canDoFieldJob } from "../auth/roles";
import { listHireGaps } from "./prehire-checks";
import { licenceCheckWindowDays } from "./licence-window";
import { recordVehicleHandover } from "./handover";
import { activeReservationFor, startHireFromHandover } from "./hire-start";
import { recordClaimEvent } from "./chronology";
import { touchFleetVersion } from "./fleet";
import { fleetAvailability } from "./fleet-availability";
import { allFleetCarDetails, fleetCarDetails, fleetGroupChoices, missingWords, type FleetCarDetails } from "./fleet-details";
import {
  agreementMandatoryGaps,
  currentHireEpisode,
  groupChargedFor,
  hireHandoverBlock,
  hireRateLine,
  needReasonFor,
  readSignedUpload,
  recordSignedAgreementOverride,
  signedAgreementOverride,
  signedHireAgreementOnFile,
  storeSignedHireAgreement,
  storeSignedRenewal,
  unsignedRenewal,
  type HireGapLink,
  type HireRateView,
  type SignedAgreementFile,
  type SignedAgreementOverride,
} from "./hire-readiness";
import { all, get, newId, run } from "./connection";
import { latestEsign, type EsignView } from "./esign";
import { beforeSigningFor, type BeforeSigning } from "./hire-out-readings";
import { withImmediateTransaction } from "./record-version";
import { replaySubmit, storeSubmit } from "./submit-key";

export type HireCarChoice = {
  id: string;
  registration: string;
  make: string;
  model: string;
  transmission: string;
  seats: number | null;
  fuel: string;
  colour: string;
  gtaGroup: string | null;
  vehicleClass: string;
  label: string;
  version: string;
};

export type HireCarFilters = { date: string; transmission: string; vehicleClass: string; seats: string };

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
  hireReason: string;
  checksDone: boolean;
  gaps: Array<{ key: string; kind: string; label: string; href: string }>;
  agreementGaps: HireGapLink[];
  /** Mileage and fuel out, transmission and licence date of issue, needed before the client signs. */
  beforeSigning: BeforeSigning;
  agreementCount: number;
  agreement: { id: string; title: string; createdAt: string } | null;
  signed: SignedAgreementFile | null;
  signedOverride: SignedAgreementOverride | null;
  esign: EsignView | null;
  windowDays: number;
  chosen: {
    fleetVehicleId: string;
    episodeId: string;
    label: string;
    registration: string;
    reservationId: string | null;
    /** Everything the fleet record holds on the car, and what is missing from it. */
    details: FleetCarDetails | null;
  } | null;
  /** GTA groups offered when the supplied car has none on its fleet record. */
  groupChoices: string[];
  startedAt: string | null;
  dayCount: number | null;
  renewal: string | null;
  /** A renewal logged and not yet signed, waiting for the signed copy. */
  unsignedRenewal: number | null;
  ratePence: number | null;
  rate: HireRateView;
  rateMissing: boolean;
  canChangeRate: boolean;
  groupCharged: string | null;
  clientGroup: string | null;
  /** The client's own car, to explain the suggested group charged. */
  clientVehicle: string;
  /** Groups in the GTA table in force today, for the group charged list. */
  rateGroups: string[];
  cars: HireCarChoice[];
  carsMissingDetails: HireCarChoice[];
  filters: HireCarFilters;
  delivery: {
    method: "deliver" | "collect";
    date: string;
    time: string;
    address: string;
    jobId: string | null;
    assigneeId: string | null;
    assigneeName: string | null;
  } | null;
  collectionJobId: string | null;
  handoverId: string | null;
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
    make: string | null;
    model: string | null;
  }>(
    `SELECT c.id, c.file_reference, c.claim_type, p.full_name AS client_name, p.telephone, p.email,
            p.address_line1, p.town, p.postcode, p.licence_number,
            v.transmission, v.seats, v.vehicle_class, v.gta_group, v.registration, v.make, v.model
     FROM claims c
     LEFT JOIN people p ON p.id = c.client_person_id
     LEFT JOIN vehicles v ON v.id = c.client_vehicle_id
     WHERE c.id = ?`,
    [claimId],
  );
}

function carChoice(car: FleetCarDetails): Omit<HireCarChoice, "label" | "version"> {
  return {
    id: car.fleetVehicleId,
    registration: car.registration,
    make: car.make,
    model: car.model,
    transmission: car.transmission,
    seats: car.seats,
    fuel: car.fuel,
    colour: car.colour,
    gtaGroup: car.gtaGroup,
    vehicleClass: car.vehicleClass,
  };
}

function knownTransmission(value: string | null | undefined): string {
  const text = String(value || "").trim().toLowerCase();
  return text === "manual" || text === "automatic" ? text : "";
}

function deliveryClock(date: string, time: string): { at: string; day: string; endDay: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Enter the delivery or collection date.");
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("Enter the time.");
  const at = requireLondonDateTime(`${date}T${time}`);
  return { at, day: date, endDay: agreementHoldEndDay(date) };
}

function defaultDriverId(): string | null {
  const row = get<{ id: string }>(
    `SELECT id FROM staff WHERE active = 1 AND role = 'driver'
     ORDER BY CASE WHEN id = 'staff-driver' THEN 0 ELSE 1 END, name LIMIT 1`,
  );
  return row ? String(row.id) : null;
}

/** Blank means unassigned. Anyone else must be able to do a field job. */
function chosenDriver(driverId: string | null | undefined): string | null {
  const id = String(driverId || "").trim();
  if (!id) return null;
  const person = get<{ id: string; role: string }>(`SELECT id, role FROM staff WHERE id = ? AND active = 1`, [id]);
  if (!person || !canDoFieldJob(person.role)) throw new Error("Choose a driver, or leave the job unassigned.");
  return String(person.id);
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

/** The Settings rate for the group charged on this file, or null when there is no group or no rate. */
function settingsRate(claimId: string): { ratePence: number | null; group: string | null } {
  const group = groupChargedFor(claimId);
  return { ratePence: settingsDailyRatePence(group), group };
}

function ensurePackRow(claimId: string) {
  const existing = get<{ claim_id: string }>(`SELECT claim_id FROM hire_pack_data WHERE claim_id = ?`, [claimId]);
  if (!existing) run(`INSERT INTO hire_pack_data(claim_id, updated_at) VALUES (?, ?)`, [claimId, nowUtcIso()]);
}

function syncPackDraft(claimId: string, address: string, ratePence: number | null) {
  ensurePackRow(claimId);
  run(
    `UPDATE hire_pack_data
     SET delivery_address = CASE WHEN ? != '' THEN ? ELSE delivery_address END,
         daily_rate_pence = COALESCE(?, daily_rate_pence),
         daily_rate_manual = CASE WHEN ? IS NOT NULL THEN 0 ELSE daily_rate_manual END,
         updated_at = ?
     WHERE claim_id = ?`,
    [address, address, ratePence, ratePence, nowUtcIso(), claimId],
  );
}

function upsertJob(input: {
  claimId: string;
  episodeId: string;
  kind: "hire_delivery" | "hire_collection";
  workDate: string;
  plannedAt: string;
  place: string;
  actorId: string;
  assigneeId: string | null;
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
      [input.episodeId, input.workDate, input.plannedAt, input.place, input.assigneeId, existing.id],
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
      input.assigneeId,
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
    if (reason.length > 1000) throw new Error("Keep the reason short.");
    const details =
      input.choice === "yes"
        ? `Replacement vehicle: yes.${reason ? ` Why: ${reason}` : ""}`
        : input.choice === "not_yet"
          ? "Replacement vehicle: not yet. Client keeps own car for now."
          : `Replacement vehicle: no. Reason: ${reason}`;
    if (input.choice === "yes" && reason) {
      ensurePackRow(input.claimId);
      run(`UPDATE hire_pack_data SET need_reason = ?, updated_at = ? WHERE claim_id = ?`, [reason, nowUtcIso(), input.claimId]);
    }
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
  driverId?: string | null;
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
    const assigneeId = input.method === "deliver" ? chosenDriver(input.driverId) : null;
    const availability = fleetAvailability({ startAt: clock.at, endAt, ignoreClaimId: input.claimId }).find(
      (row) => row.carId === input.fleetVehicleId,
    );
    if (!availability || availability.state === "removed") throw new Error("That car is not on the fleet.");
    if (!availability.free) throw new Error(carNotFreeMessage(availability));
    const car = fleetCarDetails(input.fleetVehicleId);
    if (!car) throw new Error("That car is not on the fleet.");
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
    // A rate already stored on this hire is kept. Settings is read only when there is none yet.
    const storedRate = Number(openEpisode?.rate_pence_per_day) > 0 ? Number(openEpisode?.rate_pence_per_day) : null;
    const fresh = creditHire && !storedRate ? settingsRate(input.claimId) : { ratePence: null, group: null };
    const takenOn = londonTodayIso();
    let episodeId = "";
    if (!openEpisode) {
      episodeId = newId("he");
      run(
        `INSERT INTO hire_episodes(
          id, claim_id, fleet_vehicle_id, started_at, like_for_like, suitability_reason, credit_hire, rate_pence_per_day, rate_taken_on, rate_group
        ) VALUES (?, ?, ?, NULL, 0, '', ?, ?, ?, ?)`,
        [episodeId, input.claimId, input.fleetVehicleId, creditHire, fresh.ratePence, fresh.ratePence ? takenOn : null, fresh.ratePence ? fresh.group : null],
      );
    } else {
      episodeId = String(openEpisode.id);
      run(`UPDATE hire_episodes SET fleet_vehicle_id = ?, credit_hire = ? WHERE id = ?`, [input.fleetVehicleId, creditHire, episodeId]);
      if (fresh.ratePence) {
        run(
          `UPDATE hire_episodes SET rate_pence_per_day = ?, rate_taken_on = ?, rate_group = ?
           WHERE id = ? AND (rate_pence_per_day IS NULL OR rate_pence_per_day <= 0)`,
          [fresh.ratePence, takenOn, fresh.group, episodeId],
        );
      }
    }
    releaseReservations(input.claimId, input.fleetVehicleId);
    if (previousFleet && previousFleet !== input.fleetVehicleId) freeFleetIfIdle(previousFleet);
    const same = get<{ id: string }>(
      `SELECT id FROM reservations
       WHERE claim_id = ? AND fleet_vehicle_id = ? AND status IN ('reserved', 'active') LIMIT 1`,
      [input.claimId, input.fleetVehicleId],
    );
    const reservationId = same ? String(same.id) : newId("res");
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          reservationId,
          input.fleetVehicleId,
          input.claimId,
          clock.at,
          endAt,
          kind,
          openEpisode?.started_at ? "active" : "reserved",
          input.actorId,
          nowUtcIso(),
        ],
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
        assigneeId,
      });
    } else {
      cancelOpenJobs(input.claimId, "hire_delivery");
    }
    const rate = storedRate || fresh.ratePence;
    if (creditHire) syncPackDraft(input.claimId, place, rate);
    const label = [car.make, car.model, car.registration].filter(Boolean).join(" ");
    const driverName = assigneeId ? String(get<{ name: string }>(`SELECT name FROM staff WHERE id = ?`, [assigneeId])?.name || "") : "";
    const rateWords = !creditHire
      ? ""
      : storedRate
        ? ""
        : fresh.ratePence
          ? ` Daily rate ${formatGbp(fresh.ratePence)} stored from Settings for group ${fresh.group}.`
          : " Daily rate missing: set the group charged.";
    const how =
      input.method === "deliver"
        ? `delivery${driverName ? ` by ${driverName}` : ", driver not yet chosen"}`
        : "client collection";
    recordClaimEvent({
      claimId: input.claimId,
      eventType: openEpisode?.started_at ? "hire_vehicle_changed" : "hire_vehicle_reserved",
      occurredAt: nowUtcIso(),
      actorId: input.actorId,
      details: openEpisode?.started_at
        ? `Hire car changed to ${label}. The hire start date was not changed. Charges follow the original handover. One continuous hire. No new agreement page was produced: the CAS terms define the Hire Vehicle as including any vehicle CAS replaces it with during the Rental Period.`
        : `Reserved ${label} for ${how} on ${formatUkDateTime(clock.at)}. A reservation does not start hire charges.${rateWords}${
            car.missing.length ? ` Not on the fleet record yet: ${missingWords(car.missing)}.` : ""
          }`,
      source: "staff",
    });
    return { reservationId, episodeId, jobId, missing: agreementMandatoryGaps(input.claimId).map((gap) => gap.label) };
  });
}

/**
 * Stores the daily rate for the group charged, from Settings, on this hire with today's date.
 * A rate already stored is not changed once the agreement has been produced or the car handed over.
 */
export function setHireDailyRate(input: { claimId: string; group: string; actorId: string; submitKey: string }) {
  return once(input.submitKey, () => {
    const claim = claimRow(input.claimId);
    if (!claim) throw new Error("File not found.");
    if (claim.claim_type === "fault") throw new Error("A courtesy car has no daily rate.");
    const episode = currentHireEpisode(input.claimId);
    if (!episode?.fleet_vehicle_id) throw new Error("Choose a car first. The daily rate is stored on the hire.");
    const agreements = Number(
      get<{ n: number }>(`SELECT COUNT(*) AS n FROM documents WHERE claim_id = ? AND template_key = 'hire_agreement'`, [input.claimId])?.n || 0,
    );
    const hasRate = Number(episode.rate_pence_per_day) > 0;
    if (hasRate && (episode.started_at || agreements > 0)) {
      throw new Error("The daily rate is already stored on this hire. It is not changed after the agreement or the handover.");
    }
    const group = settingsGtaGroup(input.group);
    if (!group) throw new Error("Choose the group charged from the GTA table in Settings.");
    const ratePence = settingsDailyRatePence(group);
    if (!ratePence) throw new Error("Settings has no GTA rate in force for that group today. Add the published table in Settings.");
    const takenOn = londonTodayIso();
    ensurePackRow(input.claimId);
    run(
      `UPDATE hire_pack_data SET group_charged = ?, daily_rate_pence = ?, daily_rate_manual = 0, updated_at = ? WHERE claim_id = ?`,
      [group, ratePence, nowUtcIso(), input.claimId],
    );
    run(`UPDATE hire_episodes SET rate_pence_per_day = ?, rate_taken_on = ?, rate_group = ? WHERE id = ?`, [
      ratePence,
      takenOn,
      group,
      episode.id,
    ]);
    run(
      `UPDATE agreements SET rate_pence_per_day = ? WHERE hire_episode_id = ? AND (rate_pence_per_day IS NULL OR rate_pence_per_day <= 0)`,
      [ratePence, episode.id],
    );
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "other",
      occurredAt: nowUtcIso(),
      actorId: input.actorId,
      details: `Daily rate ${formatGbp(ratePence)} stored on this hire from Settings for group ${group}, on ${formatUkDate(takenOn)}. A later change to Settings does not change it.`,
      source: "staff",
    });
    return { ratePence, group };
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
  signedCopy?: { buffer: Buffer; filename: string; mimeType: string } | null;
  overrideReason?: string;
  timingReason?: string;
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
    const signedCopy = input.signedCopy ? readSignedUpload(input.signedCopy) : null;
    const overrideReason = String(input.overrideReason || "").trim();
    if (!signedCopy && overrideReason && !signedHireAgreementOnFile(input.claimId)) {
      recordSignedAgreementOverride({ claimId: input.claimId, actorId: input.actorId, reason: overrideReason });
    }
    const blocked = hireHandoverBlock(input.claimId, { asAtYmd: clock.day, signedCopyComing: Boolean(signedCopy) });
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
      timingReason: input.timingReason,
      signedCopyComing: Boolean(signedCopy),
    });
    const started = startHireFromHandover({
      claimId: input.claimId,
      occurredAt: clock.at,
      actorId: input.actorId,
      hireEpisodeId: String(episode.id),
    });
    if (signedCopy) storeSignedHireAgreement({ claimId: input.claimId, actorId: input.actorId, file: signedCopy, startDay: clock.day });
    // The car has been handed over, so the delivery job is done, by the person who did it.
    run(
      `UPDATE day_assignments SET completed_at = ?, actual_driver_id = ?, actual_occurred_at = ?
       WHERE claim_id = ? AND job_kind = 'hire_delivery' AND cancelled_at IS NULL AND completed_at IS NULL`,
      [nowUtcIso(), input.driverId, clock.at, input.claimId],
    );
    return { handoverId: saved.id, startedAt: started.startedAt, already: started.already };
  });
}

/** Signed copy uploaded after the hire has started, for example on a file handed over before this rule. */
export function uploadSignedHireAgreement(input: {
  claimId: string;
  actorId: string;
  submitKey: string;
  file: { buffer: Buffer; filename: string; mimeType: string };
}) {
  return once(input.submitKey, () => {
    if (!currentHireEpisode(input.claimId)?.fleet_vehicle_id) throw new Error("Choose a car first.");
    return storeSignedHireAgreement({ claimId: input.claimId, actorId: input.actorId, file: input.file });
  });
}

export function uploadSignedRenewal(input: {
  claimId: string;
  actorId: string;
  submitKey: string;
  file: { buffer: Buffer; filename: string; mimeType: string };
}) {
  return once(input.submitKey, () => storeSignedRenewal({ claimId: input.claimId, actorId: input.actorId, file: input.file }));
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
      assigneeId: defaultDriverId(),
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

/**
 * The Hire tab. Filters left undefined use the client's own car (known transmission, at least its seats).
 * A blank filter means no filter.
 */
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
  const episode = currentHireEpisode(claimId);
  const reservation = activeReservationFor(claimId);
  const date = filters.date && /^\d{4}-\d{2}-\d{2}$/.test(filters.date) ? filters.date : londonTodayIso();
  const used: HireCarFilters = {
    date,
    transmission: filters.transmission ?? knownTransmission(claim.transmission),
    vehicleClass: filters.vehicleClass ?? "",
    seats: filters.seats ?? (claim.seats ? String(claim.seats) : ""),
  };
  const wantTransmission = knownTransmission(used.transmission);
  const wantSeats = /^\d+$/.test(used.seats) ? Number(used.seats) : null;
  const wantClass = used.vehicleClass.trim().toLowerCase();
  const details = allFleetCarDetails();
  const free = fleetAvailability({ startAt: date, endAt: agreementHoldEndDay(date), ignoreClaimId: claimId })
    .filter((row) => row.free)
    .map((row) => details.get(row.carId))
    .filter((car): car is NonNullable<typeof car> => Boolean(car))
    .map((car) => ({
      ...carChoice(car),
      label: [car.make, car.model, car.registration].filter(Boolean).join(" "),
      version: car.version,
    }))
    .sort((a, b) => a.registration.localeCompare(b.registration, "en-GB", { numeric: true }));
  const missingDetails = (car: HireCarChoice) => !knownTransmission(car.transmission) || car.seats == null;
  const cars = free.filter((car) => {
    if (missingDetails(car)) return false;
    if (wantTransmission && knownTransmission(car.transmission) !== wantTransmission) return false;
    if (wantSeats != null && (car.seats ?? 0) < wantSeats) return false;
    if (wantClass && car.vehicleClass.trim().toLowerCase() !== wantClass) return false;
    return true;
  });
  const carsMissingDetails = free.filter((car) => missingDetails(car) && (!wantClass || !car.vehicleClass || car.vehicleClass.trim().toLowerCase() === wantClass));
  const address = [claim.address_line1, claim.town, claim.postcode].filter(Boolean).join(", ");
  const deliveryJob = get<{
    id: string;
    work_date: string;
    planned_at: string | null;
    place_text: string | null;
    assignee_id: string | null;
    assignee_name: string | null;
  }>(
    `SELECT a.id, a.work_date, a.planned_at, a.place_text, a.assignee_id, s.name AS assignee_name
     FROM day_assignments a LEFT JOIN staff s ON s.id = a.assignee_id
     WHERE a.claim_id = ? AND a.job_kind = 'hire_delivery' AND a.cancelled_at IS NULL AND a.completed_at IS NULL
     ORDER BY a.created_at DESC LIMIT 1`,
    [claimId],
  );
  const reservationRow = reservation
    ? get<{ start_at: string }>(`SELECT start_at FROM reservations WHERE id = ?`, [reservation.id])
    : undefined;
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
  const startedAt = episode?.started_at ? String(episode.started_at) : null;
  const count = renewalLine(startedAt, creditHire);
  const chosen = episode?.fleet_vehicle_id
    ? {
        fleetVehicleId: String(episode.fleet_vehicle_id),
        episodeId: String(episode.id),
        label: [episode.make, episode.model, episode.registration].filter(Boolean).join(" "),
        registration: String(episode.registration || ""),
        reservationId: reservation ? String(reservation.id) : null,
        details: fleetCarDetails(String(episode.fleet_vehicle_id)),
      }
    : null;
  const agreementRow = get<{ id: string; title: string | null; created_at: string }>(
    `SELECT id, title, created_at FROM documents WHERE claim_id = ? AND template_key = 'hire_agreement'
     ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    [claimId],
  );
  const agreementCount = Number(
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM documents WHERE claim_id = ? AND template_key = 'hire_agreement'`, [claimId])?.n || 0,
  );
  const rate = hireRateLine(episode);
  const rateMissing = creditHire && Boolean(chosen) && rate.ratePence == null;
  const agreementGaps = creditHire && need === "yes" ? agreementMandatoryGaps(claimId) : [];
  const signed = creditHire ? signedHireAgreementOnFile(claimId) : null;
  const signedOverride = creditHire ? signedAgreementOverride(claimId) : null;
  const base = `/claims/${claimId}/hire`;
  let next = { label: "Hire needed?", href: `${base}#need` };
  if (need === "no") next = { label: "Hire not needed", href: `${base}#need` };
  else if (!need || need === "not_yet") next = { label: "Hire needed?", href: `${base}#need` };
  else if (!chosen) next = { label: "Choose a car", href: `${base}#car` };
  else if (rateMissing) next = { label: "Set the daily rate", href: `${base}#rate` };
  else if (gaps.length) next = { label: "Pre-hire checks", href: `${base}#checks` };
  else if (creditHire && agreementCount === 0 && !startedAt) next = { label: "Produce the agreement", href: `${base}#pack` };
  else if (!startedAt) next = { label: "Handover", href: `${base}#handover` };
  else next = { label: "On hire", href: `${base}#on-hire` };
  const plannedAt = deliveryJob?.planned_at ? String(deliveryJob.planned_at) : reservationRow?.start_at ? String(reservationRow.start_at) : null;
  const planned = plannedAt ? toLondonDateTimeLocal(plannedAt) : "";
  const clientGroup = normaliseGtaGroup(claim.gta_group);
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
    hireReason: needReasonFor(claimId),
    checksDone: gaps.length === 0,
    gaps,
    agreementGaps,
    beforeSigning: beforeSigningFor(claimId),
    agreementCount,
    agreement: agreementRow
      ? { id: String(agreementRow.id), title: String(agreementRow.title || "Hire agreement"), createdAt: String(agreementRow.created_at) }
      : null,
    signed,
    signedOverride,
    esign: creditHire ? latestEsign(claimId) : null,
    windowDays: licenceCheckWindowDays(),
    chosen,
    startedAt,
    dayCount: count.dayCount,
    renewal: count.renewal,
    unsignedRenewal: unsignedRenewal(claimId)?.sequence ?? null,
    ratePence: rate.ratePence,
    rate,
    rateMissing,
    canChangeRate: creditHire && Boolean(chosen) && !startedAt && agreementCount === 0,
    groupCharged: groupChargedFor(claimId),
    clientGroup,
    clientVehicle: [claim.make, claim.model, claim.registration].map((part) => String(part || "").trim()).filter((part) => part && !/^unknown$/i.test(part)).join(" "),
    rateGroups: creditHire ? settingsGtaGroups() : [],
    cars,
    carsMissingDetails,
    groupChoices: fleetGroupChoices(),
    filters: used,
    delivery: deliveryJob
      ? {
          method: "deliver",
          date: String(deliveryJob.work_date),
          time: planned.length >= 16 ? planned.slice(11, 16) : "",
          address: String(deliveryJob.place_text || address),
          jobId: String(deliveryJob.id),
          assigneeId: deliveryJob.assignee_id ? String(deliveryJob.assignee_id) : null,
          assigneeName: deliveryJob.assignee_name ? String(deliveryJob.assignee_name) : null,
        }
      : chosen
        ? {
            method: "collect",
            date: planned ? planned.slice(0, 10) : date,
            time: planned.length >= 16 ? planned.slice(11, 16) : "",
            address,
            jobId: null,
            assigneeId: null,
            assigneeName: null,
          }
        : null,
    collectionJobId: collection ? String(collection.id) : null,
    handoverId: handover ? String(handover.id) : null,
    next,
    heldElsewhere: null,
  };
}

export { AGREEMENT_LENGTH_DAYS };
