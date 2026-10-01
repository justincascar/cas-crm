import { nowUtcIso } from "../dates";
import { isOfficeRole } from "../auth/roles";
import {
  CLAIM_DOCUMENT_TYPES,
  DOCUMENT_PURPOSES,
  MAX_CLAIM_DOCUMENT_BYTES,
  claimDocumentMime,
  claimDocumentTypeLabel,
  isClaimDocumentType,
  type ClaimDocumentType,
} from "../domain/claim-documents";
import { storeFileCopy } from "../storage/files";
import { recordClaimEvent } from "./chronology";
import { all, get, getDb, newId, run } from "./connection";
import { insertStoredDocument } from "./documents-store";

export type ClaimDocumentFile = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
};

export type ClaimFileDocument = {
  id: string;
  claimId: string;
  documentType: ClaimDocumentType;
  typeLabel: string;
  title: string;
  version: number;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  vehicleLabel: string;
  replacesDocumentId: string | null;
  earlier: ClaimFileDocument[];
};

type Row = {
  id: string;
  claim_id: string;
  document_type: string;
  title: string;
  version: number;
  original_filename: string | null;
  mime_type: string | null;
  byte_size: number | null;
  created_at: string;
  replaces_document_id: string | null;
  vehicle_id: string | null;
  fleet_vehicle_id: string | null;
  client_reg: string | null;
  client_make: string | null;
  client_model: string | null;
  fleet_reg: string | null;
  fleet_make: string | null;
  fleet_model: string | null;
};

function vehicleLabel(row: Pick<Row, "client_reg" | "client_make" | "client_model" | "fleet_reg" | "fleet_make" | "fleet_model" | "vehicle_id" | "fleet_vehicle_id">): string {
  if (row.fleet_vehicle_id) {
    return [row.fleet_make, row.fleet_model, row.fleet_reg].filter(Boolean).join(" ") || "CAS vehicle";
  }
  if (row.vehicle_id) {
    return [row.client_make, row.client_model, row.client_reg].filter(Boolean).join(" ") || "Client's vehicle";
  }
  return "Not linked to one vehicle";
}

function toDocument(row: Row, earlier: ClaimFileDocument[] = []): ClaimFileDocument {
  const type = isClaimDocumentType(row.document_type) ? row.document_type : "other";
  return {
    id: row.id,
    claimId: row.claim_id,
    documentType: type,
    typeLabel: claimDocumentTypeLabel(row.document_type) || row.document_type,
    title: row.title,
    version: Number(row.version) || 1,
    originalFilename: row.original_filename || "document",
    mimeType: row.mime_type || "",
    byteSize: Number(row.byte_size) || 0,
    createdAt: row.created_at,
    vehicleLabel: vehicleLabel(row),
    replacesDocumentId: row.replaces_document_id,
    earlier,
  };
}

function ensureReplacesColumn() {
  const columns = all<{ name: string }>(`PRAGMA table_info(documents)`);
  if (columns.length > 0 && !columns.some((column) => column.name === "replaces_document_id")) {
    run(`ALTER TABLE documents ADD COLUMN replaces_document_id TEXT`);
  }
}

function listRows(claimId: string): Row[] {
  ensureReplacesColumn();
  const types = CLAIM_DOCUMENT_TYPES.map((item) => item.value);
  const marks = types.map(() => "?").join(", ");
  return all<Row>(
    `SELECT d.id, d.claim_id, d.document_type, d.title, d.version, d.original_filename, d.mime_type, d.byte_size,
            d.created_at, d.replaces_document_id, d.vehicle_id, d.fleet_vehicle_id,
            v.registration AS client_reg, v.make AS client_make, v.model AS client_model,
            fv_v.registration AS fleet_reg, fv_v.make AS fleet_make, fv_v.model AS fleet_model
     FROM documents d
     LEFT JOIN vehicles v ON v.id = d.vehicle_id
     LEFT JOIN fleet_vehicles fv ON fv.id = d.fleet_vehicle_id
     LEFT JOIN vehicles fv_v ON fv_v.id = fv.vehicle_id
     WHERE d.claim_id = ? AND d.document_type IN (${marks})
     ORDER BY d.created_at DESC`,
    [claimId, ...types],
  );
}

export function listClaimFileDocuments(claimId: string): ClaimFileDocument[] {
  const rows = listRows(claimId);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const replaced = new Set(rows.map((row) => row.replaces_document_id).filter((id): id is string => Boolean(id)));
  return rows
    .filter((row) => !replaced.has(row.id))
    .map((row) => {
      const earlier: ClaimFileDocument[] = [];
      let cursor = row.replaces_document_id;
      const seen = new Set<string>([row.id]);
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        const previous = byId.get(cursor);
        if (!previous) break;
        earlier.push(toDocument(previous));
        cursor = previous.replaces_document_id;
      }
      return toDocument(row, earlier);
    });
}

export function claimDocumentVehicleChoices(claimId: string): {
  client: { id: string; label: string } | null;
  fleet: Array<{ id: string; label: string }>;
} {
  const client = get<{ id: string; registration: string | null; make: string | null; model: string | null }>(
    `SELECT v.id, v.registration, v.make, v.model
     FROM claims c JOIN vehicles v ON v.id = c.client_vehicle_id
     WHERE c.id = ?`,
    [claimId],
  );
  const fleet = all<{ id: string; registration: string | null; make: string | null; model: string | null }>(
    `SELECT DISTINCT fv.id, v.registration, v.make, v.model
     FROM hire_episodes h
     JOIN fleet_vehicles fv ON fv.id = h.fleet_vehicle_id
     JOIN vehicles v ON v.id = fv.vehicle_id
     WHERE h.claim_id = ?
     ORDER BY v.registration`,
    [claimId],
  );
  const label = (row: { registration: string | null; make: string | null; model: string | null }) =>
    [row.make, row.model, row.registration].filter(Boolean).join(" ");
  return {
    client: client ? { id: client.id, label: label(client) || "Client's vehicle" } : null,
    fleet: fleet.map((row) => ({ id: row.id, label: label(row) || "CAS vehicle" })),
  };
}

export function claimDocumentGaps(claimId: string): Array<{
  id: string;
  label: string;
  detail: string;
  items: Array<{ type: ClaimDocumentType; label: string; onFile: boolean }>;
}> {
  const onFile = new Set(listClaimFileDocuments(claimId).map((item) => item.documentType));
  return DOCUMENT_PURPOSES.map((purpose) => ({
    id: purpose.id,
    label: purpose.label,
    detail: purpose.detail,
    items: purpose.types.map((type) => ({
      type,
      label: claimDocumentTypeLabel(type),
      onFile: onFile.has(type),
    })),
  }));
}

function assertOffice(role: string) {
  if (!isOfficeRole(role)) throw new Error("You cannot store documents on a file.");
}

function readFile(file: ClaimDocumentFile): { buffer: Buffer; filename: string; mimeType: string } {
  const filename = (file.filename || "").trim() || "document";
  if (!file.buffer || file.buffer.length < 1) throw new Error("Choose a file to store.");
  if (file.buffer.length > MAX_CLAIM_DOCUMENT_BYTES) throw new Error("Each document must be 12 MB or smaller.");
  return { buffer: file.buffer, filename, mimeType: claimDocumentMime(filename, file.mimeType) };
}

function linksFor(claimId: string, documentType: ClaimDocumentType, vehicleChoice: string): { vehicleId: string | null; fleetVehicleId: string | null } {
  const claim = get<{ client_vehicle_id: string | null }>(`SELECT client_vehicle_id FROM claims WHERE id = ?`, [claimId]);
  if (!claim) throw new Error("File not found.");
  const choice = vehicleChoice.trim();
  const spec = CLAIM_DOCUMENT_TYPES.find((item) => item.value === documentType);
  let vehicleId: string | null = null;
  let fleetVehicleId: string | null = null;
  if (choice === "client") {
    if (!claim.client_vehicle_id) throw new Error("This file has no client vehicle to link.");
    vehicleId = claim.client_vehicle_id;
  } else if (choice.startsWith("fleet:")) {
    const fleetId = choice.slice("fleet:".length);
    const episode = get<{ id: string }>(
      `SELECT id FROM hire_episodes WHERE claim_id = ? AND fleet_vehicle_id = ?`,
      [claimId, fleetId],
    );
    if (!episode) throw new Error("That hire vehicle is not on this file.");
    fleetVehicleId = fleetId;
  } else if (choice) {
    throw new Error("Choose a vehicle on this file, or leave the document unlinked.");
  }
  if (spec?.vehicle === "client" && claim.client_vehicle_id) vehicleId = claim.client_vehicle_id;
  if (spec?.vehicle === "fleet" && !fleetVehicleId) {
    const hires = all<{ fleet_vehicle_id: string | null }>(
      `SELECT fleet_vehicle_id FROM hire_episodes WHERE claim_id = ? AND fleet_vehicle_id IS NOT NULL`,
      [claimId],
    );
    const ids = [...new Set(hires.map((row) => row.fleet_vehicle_id).filter((id): id is string => Boolean(id)))];
    if (ids.length === 1) fleetVehicleId = ids[0];
    else if (ids.length > 1) throw new Error("Choose the CAS vehicle this document belongs to.");
  }
  if (spec?.vehicle === "client") fleetVehicleId = null;
  if (spec?.vehicle === "fleet") vehicleId = null;
  if (spec?.vehicle === "none") {
    vehicleId = null;
    fleetVehicleId = null;
  }
  return { vehicleId, fleetVehicleId };
}

export function storeClaimDocument(input: {
  claimId: string;
  actorId: string;
  actorRole: string;
  documentType: string;
  vehicleChoice?: string;
  replacesDocumentId?: string;
  file: ClaimDocumentFile;
}): { id: string; version: number } {
  assertOffice(input.actorRole);
  ensureReplacesColumn();
  const claim = get<{ id: string }>(`SELECT id FROM claims WHERE id = ?`, [input.claimId]);
  if (!claim) throw new Error("File not found.");
  const documentType = input.documentType.trim();
  if (!isClaimDocumentType(documentType)) throw new Error("Choose the type of document.");
  const file = readFile(input.file);
  let version = 1;
  let vehicleChoice = input.vehicleChoice || "";
  let replacesDocumentId: string | null = null;
  if (input.replacesDocumentId) {
    const previous = get<{
      id: string;
      claim_id: string;
      document_type: string;
      version: number;
      vehicle_id: string | null;
      fleet_vehicle_id: string | null;
    }>(
      `SELECT id, claim_id, document_type, version, vehicle_id, fleet_vehicle_id FROM documents WHERE id = ?`,
      [input.replacesDocumentId],
    );
    if (!previous || previous.claim_id !== input.claimId) throw new Error("That document is not on this file.");
    if (previous.document_type !== documentType) throw new Error("A newer copy keeps the same document type.");
    const already = get<{ id: string }>(`SELECT id FROM documents WHERE replaces_document_id = ?`, [previous.id]);
    if (already) throw new Error("A newer copy is already on the file. Replace that copy.");
    version = (Number(previous.version) || 1) + 1;
    replacesDocumentId = previous.id;
    vehicleChoice = previous.fleet_vehicle_id ? `fleet:${previous.fleet_vehicle_id}` : previous.vehicle_id ? "client" : "";
  }
  const links = linksFor(input.claimId, documentType, vehicleChoice);
  const label = claimDocumentTypeLabel(documentType);
  const stored = storeFileCopy({
    relDir: `claims/${input.claimId}/documents`,
    originalFilename: `${newId("file")}-${file.filename}`,
    buffer: file.buffer,
  });
  const db = getDb();
  db.exec("BEGIN");
  try {
    const id = insertStoredDocument({
      title: label,
      documentType,
      kind: "file",
      claimId: input.claimId,
      vehicleId: links.vehicleId,
      fleetVehicleId: links.fleetVehicleId,
      originalFilename: file.filename,
      storedRelpath: stored.storedRelpath,
      mimeType: file.mimeType,
      byteSize: stored.byteSize,
      createdBy: input.actorId,
      simulated: 0,
    });
    run(`UPDATE documents SET version = ?, replaces_document_id = ? WHERE id = ?`, [version, replacesDocumentId, id]);
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "document_filed",
      occurredAt: nowUtcIso(),
      actorId: input.actorId,
      documentId: id,
      details: replacesDocumentId
        ? `${label} version ${version} filed. The earlier copy is still on the file. Nothing was attached to an email.`
        : `${label} filed on the file. Nothing was attached to an email.`,
      source: "staff",
    });
    db.exec("COMMIT");
    return { id, version };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
