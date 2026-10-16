import Link from "next/link";
import { HEAD_LABELS, HEADS_OF_LOSS, type HeadOfLoss } from "@/lib/constants";
import { claimStageSteps, currentClaimStage } from "@/lib/domain/claim-stage";
import { liabilityStatusLabel, roadworthinessLabel } from "@/lib/domain/claim-status";
import { dueTextClass, dueWording } from "@/lib/domain/due-wording";
import type { HeadMoneyRow } from "@/lib/domain/head-outstanding";
import { claimRunningDaily, fleetConflictForClaim } from "@/lib/db/desk-work";
import { claimOutstandingSummary, getClaim } from "@/lib/db/queries";
import { outstandingForClaim } from "@/lib/db/outstanding";
import { listRepairGapClaims } from "@/lib/db/repair-progress";
import { formatUkDate } from "@/lib/dates";
import { formatGbp } from "@/lib/money";
import { formatVehicleRegistration } from "@/lib/text";

const INSURER_POSITION: Record<string, string> = {
  pending: "Pending",
  admitted: "Admitted",
  denied: "Denied",
  partial: "Partial",
};

function storedLabel(raw: string | null | undefined, labels: Record<string, string>): string {
  const value = String(raw || "").trim();
  if (!value) return "Not recorded";
  return labels[value] || value.replaceAll("_", " ");
}

function moneyText(pence: number): string {
  return formatGbp(pence);
}

function outstandingText(row: HeadMoneyRow): string {
  if (row.outstandingPence === null) return "none";
  return formatGbp(Math.max(0, row.outstandingPence));
}

export function ClaimSummary({ claimId }: { claimId: string }) {
  const data = getClaim(claimId);
  if (!data) return null;
  const { claim } = data;
  const id = String(claim.id);
  const insurer = data.thirdParties.find((party) => String(party.insurer_name || "").trim());
  const insurerName = insurer ? String(insurer.insurer_name) : String(claim.own_insurer_name || "");
  const insurerRef = insurer ? String(insurer.insurer_ref || "") : String(claim.own_claim_ref || "");
  const closed = data.events.some((event) => String(event.event_type) === "case_closed");
  const totalLoss = Number(claim.total_loss) === 1;
  const stage = currentClaimStage({
    closed,
    totalLoss,
    position: String(claim.current_position || ""),
    repairStatus: String(claim.repair_status || ""),
    repairsComplete: Number(claim.repairs_complete) === 1,
    engineeringStatus: String(claim.engineering_status || ""),
    recoveryStatus: String(claim.recovery_status || ""),
    needsRecovery: Number(claim.needs_recovery) === 1,
  });
  const steps = claimStageSteps(totalLoss);
  const money = claimOutstandingSummary(id);
  const byHead = new Map(money.heads.map((row) => [row.head, row]));
  const heads = HEADS_OF_LOSS.filter((head) => byHead.has(head)).map((head) => byHead.get(head)!);
  const running = claimRunningDaily(id);
  const conflict = fleetConflictForClaim(id);
  const flags = [
    ...outstandingForClaim(id).map((item) => ({
      id: item.id,
      href: `/claims/${id}#flag-${item.id}`,
      label: item.label,
    })),
    ...listRepairGapClaims()
      .filter((gap) => gap.claimId === id)
      .map((gap) => ({
        id: `gap-${gap.claimId}-${gap.wording}`,
        href: `/claims/${id}/repair`,
        label: gap.wording,
      })),
    ...(conflict ? [{ id: "fleet", href: `/claims/${id}#fleet-conflict`, label: conflict.text }] : []),
  ];
  const nextAction = String(claim.next_action || "").trim();
  const due = dueWording(claim.next_action_due ? String(claim.next_action_due) : null);
  const registration = claim.registration ? formatVehicleRegistration(String(claim.registration)) : "Not recorded";

  return (
    <section className="sticky top-0 z-30 max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-card px-4 py-3 shadow-sm" aria-label="Claim summary">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-sm text-teal-dark">{String(claim.file_reference)}</p>
        <p className="text-sm text-slate">{String(claim.handler_name || "Unassigned")}</p>
      </div>
      <p className="mt-1 text-sm">
        {String(claim.client_name || "Unknown client")} · {registration}
      </p>
      <p className="text-sm text-slate">
        {insurerName || "Insurer not recorded"}
        {insurerRef ? ` · ${insurerRef}` : ""}
      </p>
      <p className="mt-2 text-sm">
        {liabilityStatusLabel(String(claim.claim_type))} · {roadworthinessLabel(String(claim.roadworthiness))} · Insurer{" "}
        {storedLabel(claim.insurer_liability_position ? String(claim.insurer_liability_position) : "", INSURER_POSITION)}
      </p>
      <ol className="mt-3 flex flex-wrap gap-1 text-xs">
        {steps.map((step, index) => (
          <li key={step} className="flex items-center gap-1">
            {index > 0 ? <span className="text-slate">→</span> : null}
            <span className={step === stage ? "rounded bg-navy px-2 py-1 font-semibold text-white" : "rounded px-2 py-1 text-slate"}>{step}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm">
        {running.open && running.dailyPence > 0
          ? `${moneyText(running.dailyPence)}/day running`
          : running.open
            ? "Charges still running — no daily rate on the file"
            : "No hire or storage charge running"}
      </p>
      {heads.length > 0 ? (
        <table className="ledger-table ledger-fit mt-3">
          <thead>
            <tr>
              <th>Head</th>
              <th>Claimed</th>
              <th>Agreed</th>
              <th>Received</th>
              <th>Outstanding</th>
              <th>Overpaid</th>
            </tr>
          </thead>
          <tbody>
            {heads.map((row) => (
              <tr key={row.head}>
                <td>{HEAD_LABELS[row.head as HeadOfLoss] || row.head}</td>
                <td className="tabular">{moneyText(row.claimedPence)}</td>
                <td className="tabular">{row.agreedPence > 0 ? moneyText(row.agreedPence) : "—"}</td>
                <td className="tabular">{moneyText(row.receivedPence)}</td>
                <td className="tabular">{outstandingText(row)}</td>
                <td className="tabular">{row.overpaidPence > 0 ? moneyText(row.overpaidPence) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-3 text-sm text-slate">No money recorded on this file.</p>
      )}
      <p className="mt-3 text-sm">
        Next action: {nextAction || "None set"}
        {claim.next_action_due ? (
          <span className={dueTextClass(due.tone)}> · {due.text}</span>
        ) : (
          <span> · No due date</span>
        )}
      </p>
      <p className="mt-2 text-sm">
        {flags.length === 0 ? (
          "No open flags"
        ) : (
          <>
            {flags.length} open {flags.length === 1 ? "flag" : "flags"}:{" "}
            {flags.map((flag, index) => (
              <span key={flag.id}>
                {index > 0 ? " · " : null}
                <Link href={flag.href} className="text-teal-dark underline">
                  {flag.label}
                </Link>
              </span>
            ))}
          </>
        )}
      </p>
      {conflict ? (
        <p id="fleet-conflict" className="mt-2 text-sm font-semibold text-overdue">
          {conflict.text}
        </p>
      ) : null}
    </section>
  );
}
