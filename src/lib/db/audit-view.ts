import { EXPORT_AND_AUDIT } from "../auth/roles";
import { getClaimScreen } from "../claim-screens";
import { eventLabel } from "../domain/events";
import { all, get } from "./connection";
import { listStaffPermissions } from "./permissions";

/**
 * The audit view (J12): who changed what and when, on any claim. It reads two records the CRM already keeps: the
 * claim history (every dated step, email, payment and decision, with who recorded it) and the audit log (every saved
 * screen or section, with each field's old and new value, plus sign-in administration and exports).
 */

export function canExportAndAudit(staffId: string): boolean {
  return listStaffPermissions(staffId).includes(EXPORT_AND_AUDIT);
}

export type AuditFilters = { claim?: string; staffId?: string; from?: string; to?: string; kind?: string };

export type AuditRow = {
  at: string;
  who: string;
  kind: "history" | "save" | "viewed" | "other";
  what: string;
  detail: string;
  claimId: string | null;
  reference: string | null;
};

function savedWhat(scope: string): string {
  if (scope.startsWith("screen:")) {
    const screen = getClaimScreen(scope.slice(7));
    return `Saved the ${screen?.label || scope.slice(7)} screen`;
  }
  return `Saved ${scope.replaceAll("-", " ").replaceAll("_", " ")}`;
}

/** A saved screen's values as staff saw them: a choice is shown by its label, not the stored value. */
function savedDetail(scope: string, details: string): string {
  if (!scope.startsWith("screen:")) return details;
  const fields = (getClaimScreen(scope.slice(7))?.sections || []).flatMap((section) => section.fields);
  return details
    .split("; ")
    .map((part) => {
      const at = part.indexOf(": ");
      if (at < 0) return part;
      const label = part.slice(0, at);
      const field = fields.find((item) => item.label === label);
      if (!field?.options?.length) return part;
      const shown = (value: string) => (value === "blank" ? value : field.options?.find((option) => option.value === value)?.label || value);
      const [was, now] = part.slice(at + 2).split(" → ");
      return `${label}: ${shown(was)} → ${shown(now ?? "")}`;
    })
    .join("; ");
}

function otherWhat(action: string, entity: string | null): string {
  if (action === "create" && entity === "claim") return "Opened the file";
  if (action === "export") return "Full export downloaded";
  if (action === "view") return entity === "person-data" ? "Person's data screen" : "Viewed a sensitive record";
  if (entity === "staff") return `Staff sign-in: ${action.replaceAll("_", " ")}`;
  return `${action.replaceAll("_", " ")}${entity ? ` (${entity})` : ""}`;
}

/** The latest 500 entries that match the filters, newest first. */
export function listAudit(filters: AuditFilters, limit = 500): AuditRow[] {
  const claim = String(filters.claim || "").trim();
  let claimId: string | null = null;
  if (claim) {
    const found = get<{ id: string }>(`SELECT id FROM claims WHERE file_reference = ? OR id = ?`, [claim.toUpperCase(), claim]);
    if (!found) return [];
    claimId = String(found.id);
  }
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(filters.from || "")) ? `${filters.from}T00:00:00.000Z` : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(filters.to || "")) ? `${filters.to}T23:59:59.999Z` : null;
  const staffId = String(filters.staffId || "").trim() || null;
  const kind = filters.kind === "history" || filters.kind === "save" || filters.kind === "viewed" || filters.kind === "other" ? filters.kind : null;
  const rows: AuditRow[] = [];

  if (!kind || kind === "history") {
    const where = ["1 = 1"];
    const params: unknown[] = [];
    if (claimId) {
      where.push("e.claim_id = ?");
      params.push(claimId);
    }
    if (staffId) {
      where.push("e.actor_id = ?");
      params.push(staffId);
    }
    if (from) {
      where.push("e.recorded_at >= ?");
      params.push(from);
    }
    if (to) {
      where.push("e.recorded_at <= ?");
      params.push(to);
    }
    for (const row of all<{ at: string; who: string | null; event_type: string; details: string | null; claim_id: string; reference: string | null }>(
      `SELECT e.recorded_at AS at, s.name AS who, e.event_type, e.details, e.claim_id, c.file_reference AS reference
       FROM claim_events e LEFT JOIN staff s ON s.id = e.actor_id LEFT JOIN claims c ON c.id = e.claim_id
       WHERE ${where.join(" AND ")} ORDER BY e.recorded_at DESC LIMIT ?`,
      [...params, limit],
    )) {
      rows.push({
        at: String(row.at),
        who: row.who ? String(row.who) : "The CRM",
        kind: "history",
        what: eventLabel(String(row.event_type)),
        detail: String(row.details || ""),
        claimId: String(row.claim_id),
        reference: row.reference ? String(row.reference) : null,
      });
    }
  }

  if (!kind || kind === "save" || kind === "viewed" || kind === "other") {
    const where = ["1 = 1"];
    const params: unknown[] = [];
    if (kind === "save") where.push("a.action = 'save'");
    if (kind === "viewed") where.push("a.action IN ('view', 'export')");
    if (kind === "other") where.push("a.action NOT IN ('save', 'view', 'export')");
    if (claimId) {
      where.push("(a.entity_id = ? OR a.entity_id LIKE ? OR a.entity_id IN (SELECT id FROM hire_episodes WHERE claim_id = ?))");
      params.push(claimId, `${claimId}:%`, claimId);
    }
    if (staffId) {
      where.push("a.actor_id = ?");
      params.push(staffId);
    }
    if (from) {
      where.push("a.at >= ?");
      params.push(from);
    }
    if (to) {
      where.push("a.at <= ?");
      params.push(to);
    }
    for (const row of all<{ at: string; who: string | null; action: string; entity: string | null; entity_id: string | null; details: string | null }>(
      `SELECT a.at, s.name AS who, a.action, a.entity, a.entity_id, a.details
       FROM audit_log a LEFT JOIN staff s ON s.id = a.actor_id
       WHERE ${where.join(" AND ")} ORDER BY a.at DESC LIMIT ?`,
      [...params, limit],
    )) {
      const key = String(row.entity_id || "");
      const linked =
        get<{ id: string; file_reference: string }>(`SELECT id, file_reference FROM claims WHERE id = ?`, [key.split(":")[0]]) ||
        get<{ id: string; file_reference: string }>(`SELECT c.id, c.file_reference FROM hire_episodes he JOIN claims c ON c.id = he.claim_id WHERE he.id = ?`, [key]);
      rows.push({
        at: String(row.at),
        who: row.who ? String(row.who) : "The CRM",
        kind: row.action === "save" ? "save" : row.action === "view" || row.action === "export" ? "viewed" : "other",
        what: row.action === "save" ? savedWhat(String(row.entity || "")) : otherWhat(String(row.action), row.entity),
        detail: row.action === "save" ? savedDetail(String(row.entity || ""), String(row.details || "")) : String(row.details || ""),
        claimId: linked ? String(linked.id) : null,
        reference: linked ? String(linked.file_reference) : null,
      });
    }
  }

  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}
