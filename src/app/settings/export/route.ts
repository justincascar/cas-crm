import { NextResponse } from "next/server";
import { getRequestStaff } from "@/lib/auth/session";
import { canExportAndAudit } from "@/lib/db/audit-view";
import { getDb, newId, run } from "@/lib/db/connection";
import { buildFullExport } from "@/lib/ops/export";
import { filesRoot } from "@/lib/storage/files";
import { browserOrigin } from "@/lib/http/browser-origin";
import { nowUtcIso } from "@/lib/dates";

/** The full export as one zip: a CSV per table and every stored document (J12). Justin only. */
export async function GET(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!canExportAndAudit(staff.id)) return new NextResponse("Only Justin can download the full export.", { status: 403 });
  const when = new Date();
  const { zip, summary } = buildFullExport(getDb(), filesRoot(), when);
  run(`INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details) VALUES (?, ?, ?, 'export', 'all', NULL, ?)`, [
    newId("audit"),
    nowUtcIso(),
    staff.id,
    `${Object.keys(summary.tables).length} tables and ${summary.documents} documents.`,
  ]);
  const day = when.toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="cas-crm-export-${day}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
