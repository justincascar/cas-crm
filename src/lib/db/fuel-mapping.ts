import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { normaliseFuel } from "../domain/fuel";
import { toStartCase } from "../text";

/**
 * R51, once: fuel already stored (typed boxes and the V5C import) is mapped onto the fuel list — petrol → Petrol,
 * diesel → Diesel, hybrid electric → Hybrid — and anything unclear becomes Other with the old text kept. Colours saved
 * all in capitals are tidied (R23), e.g. BLACK → Black. Each change goes in the change history (audit log).
 * Third-party vehicles keep their stored values (R53); they are no longer shown or printed.
 */
const FLAG = "fuel_values_mapped_r51";

export function mapStoredFuelsOn(db: DatabaseSync) {
  if (db.prepare(`SELECT value FROM settings WHERE key = ?`).get(FLAG)) return 0;
  const rows = db
    .prepare(
      `SELECT id, registration, fuel, colour, usage FROM vehicles
       WHERE usage != 'third_party' AND ((fuel IS NOT NULL AND trim(fuel) != '') OR (colour IS NOT NULL AND trim(colour) != ''))`,
    )
    .all() as Array<{ id: string; registration: string | null; fuel: string | null; colour: string | null; usage: string }>;
  const now = new Date().toISOString();
  const audit = db.prepare(
    `INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details) VALUES (?, ?, NULL, 'vehicle_details_tidied', 'vehicle', ?, ?)`,
  );
  let changed = 0;
  for (const row of rows) {
    const fuel = row.fuel == null ? null : normaliseFuel(row.fuel) || null;
    const colourText = String(row.colour || "").trim();
    const colour = colourText && colourText === colourText.toUpperCase() && /[A-Z]/.test(colourText) ? toStartCase(colourText.toLowerCase()) : row.colour;
    const notes: string[] = [];
    if ((row.fuel ?? null) !== fuel) notes.push(`fuel "${row.fuel}" → ${fuel ? `"${fuel}"` : "Not known"}`);
    if ((row.colour ?? null) !== (colour ?? null)) notes.push(`colour "${row.colour}" → "${colour}"`);
    if (!notes.length) continue;
    db.prepare(`UPDATE vehicles SET fuel = ?, colour = ? WHERE id = ?`).run(fuel, colour ?? null, row.id);
    audit.run(randomUUID(), now, row.id, `${row.registration || "Vehicle"}: ${notes.join("; ")} (one-off tidy to the fuel list, R51).`);
    changed += 1;
  }
  db.prepare(`INSERT INTO settings(key, value) VALUES (?, ?)`).run(FLAG, now);
  return changed;
}
