import { INDICATIVE_DEFAULTS } from "../constants";
import { lineFromNet, lineFromReceipt, type RecoveryMoneyLine } from "../domain/recovery-fees";
import { inheritedLineLabel, inheritedNoteFlag, recoveryTimeFlag } from "../domain/recovery-review";
import { formatGbp } from "../money";
import { get } from "./connection";
import { recoveryJobForClaim } from "./storage-charge";

type Job = NonNullable<ReturnType<typeof recoveryJobForClaim>>;

function storedLines(json: string | null | undefined): RecoveryMoneyLine[] | null {
  const text = (json || "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as RecoveryMoneyLine[];
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((line) => line && Number(line.grossPence) > 0);
  } catch {
    return null;
  }
}

function columnLines(job: Job): RecoveryMoneyLine[] {
  const rows: Array<[string, string, number | null]> = [
    ["standard", "Standard recovery", job.charge_pence],
    ["environmental", "Environmental", job.environmental_pence],
    ["winching", "Winching", job.winch_pence],
    ["forklift", "Forklift", job.forklift_pence],
    ["outOfHours", "Out of hours", job.ooh_pence],
    ["mileage", "Mileage", job.mileage_pence],
    ["specialistWinching", "Specialist winching", job.specialist_winch_pence],
    ["skates", "Skates/dollies", job.skates_pence],
    ["waiting", "Waiting time", job.waiting_pence],
    ["secondOperator", "Second operator", job.second_operator_pence],
    ["manual", job.manual_description?.trim() ? `Manual charge: ${job.manual_description.trim()}` : "Manual charge", job.manual_pence],
  ];
  const lines: RecoveryMoneyLine[] = [];
  for (const [key, label, net] of rows) {
    const amount = Number(net) || 0;
    if (amount > 0) lines.push(lineFromNet(key, label, amount, "", INDICATIVE_DEFAULTS.vat_rate));
  }
  const company = (job.inherited_company || "").trim();
  const inheritedNet = Number(job.inherited_net_pence);
  if (company && Number.isFinite(inheritedNet) && inheritedNet >= 0 && job.inherited_vat_pence != null) {
    lines.push(lineFromReceipt("inherited", inheritedLineLabel(company), inheritedNet, Number(job.inherited_vat_pence) || 0));
  }
  return lines;
}

/** Read-only. Opening a page does not insert these lines. */
export function recoveryDisplayLines(claimId: string): RecoveryMoneyLine[] {
  const job = recoveryJobForClaim(claimId);
  if (!job) return [];
  return storedLines(job.charge_lines_json) || columnLines(job);
}

export function recoveryReviewFlags(claimId: string): string[] {
  const claim = get<{ accident_at: string | null }>(`SELECT accident_at FROM claims WHERE id = ?`, [claimId]);
  const job = recoveryJobForClaim(claimId);
  if (!job) return [];
  const flags: string[] = [];
  const inherited = inheritedNoteFlag({ note: job.inherited_note, company: job.inherited_company });
  if (inherited) flags.push(inherited);
  const time = recoveryTimeFlag(claim?.accident_at, job.recovered_at);
  if (time) flags.push(time);
  return flags;
}

export function recoveryLinesPlain(claimId: string): string[] {
  return recoveryDisplayLines(claimId).map((line) => {
    const reason = line.reason ? ` Reason: ${line.reason}.` : "";
    return `${line.label}: ${formatGbp(line.netPence)} net, VAT ${formatGbp(line.vatPence)}, ${formatGbp(line.grossPence)}.${reason}`;
  });
}
