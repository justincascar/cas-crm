import type { DatabaseSync } from "node:sqlite";
import { nowUtcIso } from "../dates";
import { get, getDb, newId, run } from "./connection";

/**
 * CAS's company details for the footer of the headed paper (review note R41). They are kept in Settings, not in the
 * letters: the footer reads them each time a document is shown or printed. The first values are the ones on Justin's
 * headed paper (docs/correspondence-templates/CAS-headed-paper.docx), and an administrator can change them.
 */

export type CompanyDetails = {
  name: string;
  companyNumber: string;
  vatNumber: string;
  registeredIn: string;
  address: string;
  email: string;
  phone: string;
};

const KEYS: Record<keyof CompanyDetails, string> = {
  name: "company_name",
  companyNumber: "company_number",
  vatNumber: "company_vat_number",
  registeredIn: "company_registered_in",
  address: "company_address",
  email: "company_email",
  phone: "company_phone",
};

export const COMPANY_DETAIL_LABELS: Record<keyof CompanyDetails, string> = {
  name: "Company name",
  companyNumber: "Company number",
  vatNumber: "VAT number",
  registeredIn: "Registered in",
  address: "Address",
  email: "Email",
  phone: "Telephone",
};

/** From the supplied headed paper. Seeded once; Settings holds them after that. */
const FROM_HEADED_PAPER: CompanyDetails = {
  name: "Complete Accident Solutions Ltd",
  companyNumber: "06805810",
  vatNumber: "996 5540 63",
  registeredIn: "England and Wales",
  address: "171 Cwmgarw Road, Brynamman, Ammanford, SA18 1DG",
  email: "info@cascar.co.uk",
  phone: "01792 341069",
};

export function ensureCompanyDetails(db: DatabaseSync) {
  for (const field of Object.keys(KEYS) as Array<keyof CompanyDetails>) {
    db.prepare(`INSERT INTO settings(key, value) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = ?)`).run(
      KEYS[field],
      FROM_HEADED_PAPER[field],
      KEYS[field],
    );
  }
}

export function getCompanyDetails(): CompanyDetails {
  ensureCompanyDetails(getDb());
  const out = {} as CompanyDetails;
  for (const field of Object.keys(KEYS) as Array<keyof CompanyDetails>) {
    out[field] = String(get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [KEYS[field]])?.value || "").trim();
  }
  return out;
}

/** An administrator changes the details. Each change is kept in the audit log. */
export function saveCompanyDetails(input: { actorId: string; values: Partial<Record<keyof CompanyDetails, string>> }) {
  const current = getCompanyDetails();
  const changed: string[] = [];
  for (const field of Object.keys(KEYS) as Array<keyof CompanyDetails>) {
    if (input.values[field] === undefined) continue;
    const value = String(input.values[field] || "").trim();
    if (!value) throw new Error(`Enter the ${COMPANY_DETAIL_LABELS[field].toLowerCase()}.`);
    if (value.length > 200) throw new Error(`Keep the ${COMPANY_DETAIL_LABELS[field].toLowerCase()} short.`);
    if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("Enter a valid email address.");
    if (value === current[field]) continue;
    run(`UPDATE settings SET value = ? WHERE key = ?`, [value, KEYS[field]]);
    changed.push(`${COMPANY_DETAIL_LABELS[field]}: ${current[field] || "blank"} → ${value}`);
  }
  if (changed.length) {
    run(`INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details) VALUES (?, ?, ?, 'company_details_changed', 'settings', 'company', ?)`, [
      newId("audit"),
      nowUtcIso(),
      input.actorId,
      changed.join("; "),
    ]);
  }
  return changed.length;
}

/** The footer of the headed paper in two tidy lines of plain text (no icons, which print as boxes in some PDFs). */
export function companyFooterLines(details: CompanyDetails): [string, string] {
  const first = [
    details.name,
    details.registeredIn ? `Registered in ${details.registeredIn}` : "",
    details.companyNumber ? `Company No ${details.companyNumber}` : "",
    details.vatNumber ? `VAT No ${details.vatNumber}` : "",
  ].filter(Boolean);
  const second = [details.address, details.email, details.phone].filter(Boolean);
  return [first.join(" · "), second.join(" · ")];
}
