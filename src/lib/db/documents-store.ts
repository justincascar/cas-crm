import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { nowUtcIso } from "../dates";
import { getDb, newId } from "./connection";

export const DOCUMENT_TYPE_V5C = "V5C";

export type StoredDocumentInput = {
  title: string;
  documentType: string;
  kind?: string;
  claimId?: string | null;
  vehicleId?: string | null;
  fleetVehicleId?: string | null;
  originalFilename: string;
  storedRelpath: string;
  mimeType: string;
  byteSize: number;
  createdBy?: string | null;
  missing?: string[];
  simulated?: number;
};

export function insertStoredDocumentOn(db: DatabaseSync, input: StoredDocumentInput): string {
  const id = newId("doc");
  db.prepare(
    `INSERT INTO documents(
      id, claim_id, vehicle_id, fleet_vehicle_id, title, kind, document_type, version, signed, simulated,
      body_html, original_filename, stored_relpath, mime_type, byte_size, created_by, missing_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    ...(
      [
        id,
        input.claimId || null,
        input.vehicleId || null,
        input.fleetVehicleId || null,
        input.title,
        input.kind || "file",
        input.documentType,
        input.simulated ?? 0,
        input.originalFilename,
        input.storedRelpath,
        input.mimeType,
        input.byteSize,
        input.createdBy || null,
        input.missing?.length ? JSON.stringify(input.missing) : null,
        nowUtcIso(),
      ] as SQLInputValue[]
    ),
  );
  return id;
}

export function insertStoredDocument(input: StoredDocumentInput): string {
  return insertStoredDocumentOn(getDb(), input);
}

export function listDocumentsForFleetVehicleOn(db: DatabaseSync, fleetVehicleId: string) {
  return db
    .prepare(
      `SELECT id, title, document_type, original_filename, stored_relpath, mime_type, byte_size, created_at, missing_json
       FROM documents
       WHERE fleet_vehicle_id = ?
       ORDER BY created_at DESC`,
    )
    .all(fleetVehicleId) as Array<{
    id: string;
    title: string;
    document_type: string | null;
    original_filename: string | null;
    stored_relpath: string | null;
    mime_type: string | null;
    byte_size: number | null;
    created_at: string;
    missing_json: string | null;
  }>;
}

export function findFleetDocumentOn(db: DatabaseSync, fleetVehicleId: string, documentType: string) {
  return db
    .prepare(
      `SELECT id, stored_relpath FROM documents WHERE fleet_vehicle_id = ? AND document_type = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(fleetVehicleId, documentType) as { id: string; stored_relpath: string | null } | undefined;
}
