import { londonTodayIso, nowUtcIso } from "../dates";
import { DRIVER_ROLE, MECHANIC_ROLE, isMechanicRole, isOfficeRole } from "../auth/roles";
import { storeFileCopy } from "../storage/files";
import { all, get, newId, run } from "./connection";
import { insertStoredDocument } from "./documents-store";

export const REPAIR_KINDS = [
  { kind: "progress_photo", label: "Repair progress photograph" },
  { kind: "pre_scan", label: "Pre-diagnostic scan" },
  { kind: "post_scan", label: "Post-diagnostic scan" },
  { kind: "geometry", label: "Geometry / wheel alignment report" },
  { kind: "other", label: "Other repair document" },
] as const;

export type RepairKind = (typeof REPAIR_KINDS)[number]["kind"];

export type DayJob = {
  id: string;
  jobKind: "handover" | "repair";
  claimId: string;
  fileReference: string;
  hireEpisodeId: string | null;
  vehicleLabel: string;
  workDate: string;
  href: string;
};

type Actor = { id: string; role: string };

function today(workDate?: string): string {
  const value = (workDate || londonTodayIso()).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Enter the day as a calendar date.");
  return value;
}

export function listMyJobs(assigneeId: string, workDate = londonTodayIso()): DayJob[] {
  const rows = all<{
    id: string;
    job_kind: string;
    claim_id: string;
    file_reference: string | null;
    hire_episode_id: string | null;
    registration: string | null;
    make: string | null;
    model: string | null;
    work_date: string;
  }>(
    `SELECT a.id, a.job_kind, a.claim_id, c.file_reference, a.hire_episode_id, a.work_date,
            v.registration, v.make, v.model
     FROM day_assignments a
     JOIN claims c ON c.id = a.claim_id
     LEFT JOIN hire_episodes he ON he.id = a.hire_episode_id
     LEFT JOIN fleet_vehicles fv ON fv.id = he.fleet_vehicle_id
     LEFT JOIN vehicles v ON v.id = COALESCE(fv.vehicle_id, c.client_vehicle_id)
     WHERE a.assignee_id = ? AND a.work_date = ?
     ORDER BY a.job_kind, c.file_reference`,
    [assigneeId, workDate],
  );
  return rows.map((row) => {
    const kind = row.job_kind === "repair" ? "repair" : "handover";
    const vehicle = [row.make, row.model, row.registration].filter(Boolean).join(" ") || "Vehicle";
    return {
      id: row.id,
      jobKind: kind,
      claimId: row.claim_id,
      fileReference: row.file_reference || "File",
      hireEpisodeId: row.hire_episode_id,
      vehicleLabel: vehicle,
      workDate: row.work_date,
      href: kind === "repair" ? `/claims/${row.claim_id}/repair` : `/claims/${row.claim_id}/handover`,
    };
  });
}

export function assignDayJob(input: {
  assigneeId: string;
  jobKind: string;
  claimId: string;
  hireEpisodeId: string;
  actorId: string;
  workDate?: string;
}): { id: string } {
  const actor = get<{ id: string; role: string }>("SELECT id, role FROM staff WHERE id = ?", [input.actorId]);
  if (!actor || !isOfficeRole(actor.role)) throw new Error("Only administrator or staff can assign a job.");
  const assignee = get<{ id: string; name: string }>(
    "SELECT id, name FROM staff WHERE id = ? AND active = 1",
    [input.assigneeId],
  );
  if (!assignee) throw new Error("Choose the person this job is for.");
  const kind = input.jobKind === "repair" ? "repair" : input.jobKind === "handover" ? "handover" : "";
  if (!kind) throw new Error("Choose a handover or a repair job.");
  let claimId = input.claimId.trim();
  let hireEpisodeId: string | null = null;
  if (kind === "handover") {
    const episodeId = input.hireEpisodeId.trim();
    if (!episodeId) throw new Error("Choose the hire booking.");
    const episode = get<{ id: string; claim_id: string }>("SELECT id, claim_id FROM hire_episodes WHERE id = ?", [episodeId]);
    if (!episode) throw new Error("That hire booking was not found.");
    hireEpisodeId = episode.id;
    claimId = episode.claim_id;
  }
  const claim = get<{ id: string }>("SELECT id FROM claims WHERE id = ?", [claimId]);
  if (!claim) throw new Error("Choose a file.");
  const workDate = today(input.workDate);
  const existing = get<{ id: string }>(
    `SELECT id FROM day_assignments
     WHERE assignee_id = ? AND job_kind = ? AND claim_id = ? AND work_date = ?
       AND ((hire_episode_id IS NULL AND ? IS NULL) OR hire_episode_id = ?)`,
    [assignee.id, kind, claimId, workDate, hireEpisodeId, hireEpisodeId],
  );
  if (existing) return { id: existing.id };
  const id = newId("job");
  const at = nowUtcIso();
  run(
    `INSERT INTO day_assignments(id, assignee_id, job_kind, claim_id, hire_episode_id, work_date, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, assignee.id, kind, claimId, hireEpisodeId, workDate, actor.id, at],
  );
  return { id };
}

function assignedToday(assigneeId: string, jobKind: "handover" | "repair", claimId: string, workDate = londonTodayIso()) {
  return get<{ id: string; hire_episode_id: string | null }>(
    `SELECT id, hire_episode_id FROM day_assignments
     WHERE assignee_id = ? AND job_kind = ? AND claim_id = ? AND work_date = ?
     ORDER BY created_at DESC LIMIT 1`,
    [assigneeId, jobKind, claimId, workDate],
  );
}

export function assertCanRecordHandover(actor: Actor, claimId: string, hireEpisodeId: string | null) {
  if (isOfficeRole(actor.role)) return;
  if (actor.role !== DRIVER_ROLE) throw new Error("You cannot record a handover.");
  if (!assignedToday(actor.id, "handover", claimId)) throw new Error("That file is not assigned to you today.");
  if (!hireEpisodeId) return;
  const job = get<{ id: string }>(
    `SELECT id FROM day_assignments
     WHERE assignee_id = ? AND job_kind = 'handover' AND claim_id = ? AND work_date = ? AND hire_episode_id = ?`,
    [actor.id, claimId, londonTodayIso(), hireEpisodeId],
  );
  if (!job) throw new Error("That booking is not assigned to you today.");
}

export function assertCanUploadRepair(actor: Actor, claimId: string) {
  if (isOfficeRole(actor.role)) return;
  if (!isMechanicRole(actor.role)) throw new Error("You cannot add repair evidence.");
  const job = assignedToday(actor.id, "repair", claimId);
  if (!job) throw new Error("That repair is not assigned to you today.");
}

export function canReadDocument(actor: Actor, documentId: string): boolean {
  if (isOfficeRole(actor.role)) return true;
  const doc = get<{ claim_id: string | null; document_type: string | null }>(
    "SELECT claim_id, document_type FROM documents WHERE id = ?",
    [documentId],
  );
  if (!doc?.claim_id) return false;
  if (actor.role === DRIVER_ROLE && doc.document_type === "handover_photo") {
    return Boolean(assignedToday(actor.id, "handover", doc.claim_id));
  }
  if (actor.role === MECHANIC_ROLE && doc.document_type === "repair_evidence") {
    return Boolean(assignedToday(actor.id, "repair", doc.claim_id));
  }
  return false;
}

const MAX_REPAIR_BYTES = 12 * 1024 * 1024;

function repairMime(filename: string, mimeType: string, kind: RepairKind): string {
  const mime = mimeType.toLowerCase();
  const lower = filename.toLowerCase();
  const image =
    mime === "image/jpeg" || mime === "image/png" || mime === "image/webp" || mime === "image/gif"
      ? mime
      : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
        ? "image/jpeg"
        : lower.endsWith(".png")
          ? "image/png"
          : lower.endsWith(".webp")
            ? "image/webp"
            : lower.endsWith(".gif")
              ? "image/gif"
              : "";
  if (kind === "progress_photo") {
    if (!image) throw new Error("A repair photograph must be JPEG, PNG, WebP or GIF.");
    return image;
  }
  if (image) return image;
  if (mime === "application/pdf" || lower.endsWith(".pdf")) return "application/pdf";
  if (mime.startsWith("text/") || lower.endsWith(".txt") || lower.endsWith(".csv") || lower.endsWith(".log")) return mime.startsWith("text/") ? mime : "text/plain";
  throw new Error("That file must be a photograph, a PDF, or a text export.");
}

export function addRepairEvidence(input: {
  claimId: string;
  actorId: string;
  actorRole: string;
  kind: string;
  note: string;
  file: { buffer: Buffer; filename: string; mimeType: string };
}): { id: string } {
  const kind = REPAIR_KINDS.find((item) => item.kind === input.kind);
  if (!kind) throw new Error("Choose what this file is.");
  assertCanUploadRepair({ id: input.actorId, role: input.actorRole }, input.claimId);
  if (input.file.buffer.length < 1) throw new Error("Choose a file.");
  if (input.file.buffer.length > MAX_REPAIR_BYTES) throw new Error("Each file must be 12 MB or smaller.");
  const mime = repairMime(input.file.filename, input.file.mimeType, kind.kind);
  const at = nowUtcIso();
  const id = newId("rep");
  const stored = storeFileCopy({
    relDir: `claims/${input.claimId}/repair/${id}`,
    originalFilename: `${newId("file")}-${input.file.filename || "repair"}`,
    buffer: input.file.buffer,
  });
  const documentId = insertStoredDocument({
    title: kind.label,
    documentType: "repair_evidence",
    kind: kind.kind === "progress_photo" ? "photograph" : "file",
    claimId: input.claimId,
    originalFilename: input.file.filename || "repair",
    storedRelpath: stored.storedRelpath,
    mimeType: mime,
    byteSize: stored.byteSize,
    createdBy: input.actorId,
    simulated: 0,
  });
  run(
    `INSERT INTO repair_evidence(id, claim_id, kind, document_id, note, recorded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.claimId, kind.kind, documentId, input.note.trim().slice(0, 1000), input.actorId, at],
  );
  return { id };
}

export type RepairFile = {
  id: string;
  kind: RepairKind;
  kindLabel: string;
  documentId: string;
  filename: string;
  note: string;
  recordedByName: string;
  createdAt: string;
};

export function listRepairEvidence(claimId: string): RepairFile[] {
  const rows = all<{
    id: string;
    kind: string;
    document_id: string;
    original_filename: string | null;
    note: string;
    recorded_by_name: string | null;
    created_at: string;
  }>(
    `SELECT r.id, r.kind, r.document_id, d.original_filename, r.note, s.name AS recorded_by_name, r.created_at
     FROM repair_evidence r
     JOIN documents d ON d.id = r.document_id
     LEFT JOIN staff s ON s.id = r.recorded_by
     WHERE r.claim_id = ?
     ORDER BY r.created_at DESC, r.id DESC`,
    [claimId],
  );
  return rows.map((row) => {
    const kind = REPAIR_KINDS.find((item) => item.kind === row.kind);
    return {
      id: row.id,
      kind: (kind?.kind || "other") as RepairKind,
      kindLabel: kind?.label || "Repair document",
      documentId: row.document_id,
      filename: row.original_filename || "file",
      note: row.note || "",
      recordedByName: row.recorded_by_name || "Staff",
      createdAt: row.created_at,
    };
  });
}

export function repairVehicleLabel(claimId: string): { fileReference: string; vehicleLabel: string } | null {
  const row = get<{ file_reference: string | null; registration: string | null; make: string | null; model: string | null }>(
    `SELECT c.file_reference, v.registration, v.make, v.model
     FROM claims c
     LEFT JOIN vehicles v ON v.id = c.client_vehicle_id
     WHERE c.id = ?`,
    [claimId],
  );
  if (!row) return null;
  return {
    fileReference: row.file_reference || "File",
    vehicleLabel: [row.make, row.model, row.registration].filter(Boolean).join(" ") || "Vehicle",
  };
}

export function listAssignablePeople() {
  return all<{ id: string; name: string; role: string }>(
    "SELECT id, name, role FROM staff WHERE active = 1 ORDER BY name",
  );
}

export function listAssignableBookings() {
  return all<{
    claim_id: string;
    file_reference: string | null;
    episode_id: string;
    registration: string | null;
    make: string | null;
    model: string | null;
  }>(
    `SELECT c.id AS claim_id, c.file_reference, he.id AS episode_id, v.registration, v.make, v.model
     FROM hire_episodes he
     JOIN claims c ON c.id = he.claim_id
     LEFT JOIN fleet_vehicles fv ON fv.id = he.fleet_vehicle_id
     LEFT JOIN vehicles v ON v.id = fv.vehicle_id
     ORDER BY c.file_reference, he.started_at DESC`,
  );
}

export function listAssignableClaims() {
  return all<{ id: string; file_reference: string | null; registration: string | null }>(
    `SELECT c.id, c.file_reference, v.registration
     FROM claims c
     LEFT JOIN vehicles v ON v.id = c.client_vehicle_id
     ORDER BY c.file_reference`,
  );
}

