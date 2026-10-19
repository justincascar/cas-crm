import { HEAD_LABELS, HEADS_OF_LOSS, type HeadOfLoss } from "@/lib/constants";
import { currentClaimStep, resolveDisplayedNextAction } from "@/lib/domain/claim-steps";
import { liabilityStatusLabel, roadworthinessLabel } from "@/lib/domain/claim-status";
import { loadClaimSteps } from "@/lib/claims/load-claim-steps";
import { dueTextClass, dueWording } from "@/lib/domain/due-wording";
import { claimRunningDaily, fleetConflictForClaim } from "@/lib/db/desk-work";
import { calculatedForHead, figureFlag, type FigureHead } from "@/lib/db/figure-resolution";
import { outstandingForClaim } from "@/lib/db/outstanding";
import { claimOutstandingSummary, getClaim } from "@/lib/db/queries";
import { listRepairGapClaims } from "@/lib/db/repair-progress";
import { formatGbp } from "@/lib/money";
import { formatVehicleRegistration } from "@/lib/text";
import { confirmedOutstandingPence, FIGURE_UNDER_REVIEW, outstandingColumnText } from "@/lib/claims/summary-money";
import { recoveryDisplayLines, recoveryReviewFlags } from "@/lib/db/recovery-display";
import { recoveryLineLabel } from "@/lib/domain/recovery-fees";

const INSURER_POSITION: Record<string, string> = {
  pending: "Pending",
  admitted: "Admitted",
  denied: "Denied",
  partial: "Partial",
};

const FIGURE_HEADS = new Set<string>(["hire", "storage", "recovery"]);

export type ClaimSummaryCharge = {
  head: string;
  label: string;
  details: string[];
  claimed: string;
  offered: string;
  agreed: string;
  received: string;
  outstanding: string;
  overpaid: string;
  reviewNote: string | null;
};

export type ClaimSummaryFlag = {
  id: string;
  href: string;
  label: string;
};

export type ClaimSummaryModel = {
  reference: string;
  client: string;
  registration: string;
  handler: string;
  insurerLine: string;
  statusLine: string;
  stageLine: string;
  runningText: string;
  runningDaily: string;
  charges: ClaimSummaryCharge[];
  outstandingTotal: string;
  nextAction: string;
  dueText: string;
  dueClass: string;
  flags: ClaimSummaryFlag[];
  conflict: string | null;
};

function storedLabel(raw: string | null | undefined, labels: Record<string, string>): string {
  const value = String(raw || "").trim();
  if (!value) return "Not recorded";
  return labels[value] || value.replaceAll("_", " ");
}

function flagHref(claimId: string, itemId: string): string {
  if (itemId.startsWith("task:")) return `/claims/${claimId}#tasks`;
  if (itemId.includes("repair")) return `/claims/${claimId}/repair`;
  return `/claims/${claimId}/work/comms`;
}

/** Read-only. A stored figure that still differs from the calculation is labelled, not changed. */
export function figureUnderReviewNote(claimId: string, head: string, storedPence: number): string | null {
  if (!FIGURE_HEADS.has(head)) return null;
  const calculated = calculatedForHead(claimId, head as FigureHead);
  const flag = figureFlag(claimId, head as FigureHead, storedPence, calculated);
  return flag.differs ? FIGURE_UNDER_REVIEW : null;
}

export function runningDailyLabel(running: { dailyPence: number; rateMissing?: boolean }): string {
  if (running.dailyPence > 0) return `${formatGbp(running.dailyPence)}/day`;
  if (running.rateMissing) return "Daily rate missing";
  return "Not running";
}

export function buildClaimSummaryModel(claimId: string): ClaimSummaryModel | null {
  const data = getClaim(claimId);
  if (!data) return null;
  const { claim } = data;
  const id = String(claim.id);
  const insurer = data.thirdParties.find((party) => String(party.insurer_name || "").trim());
  const insurerName = insurer ? String(insurer.insurer_name) : String(claim.own_insurer_name || "");
  const insurerRef = insurer ? String(insurer.insurer_ref || "") : String(claim.own_claim_ref || "");
  const stepViews = loadClaimSteps(id) || [];
  const current = stepViews.length ? currentClaimStep(stepViews) : null;
  const displayed = resolveDisplayedNextAction({
    storedAction: claim.next_action ? String(claim.next_action) : null,
    storedDue: claim.next_action_due ? String(claim.next_action_due) : null,
    steps: stepViews,
  });
  const money = claimOutstandingSummary(id);
  const byHead = new Map(money.heads.map((row) => [row.head, row]));
  const details = new Map<string, string[]>();
  for (const line of data.financials) {
    const head = String(line.head_of_loss || "");
    const description = String(line.description || "").trim();
    if (!head || !description) continue;
    const list = details.get(head) ?? [];
    list.push(description);
    details.set(head, list);
  }
  const recoveryLines = recoveryDisplayLines(id).map(recoveryLineLabel);
  if (recoveryLines.length) {
    const list = details.get("recovery") ?? [];
    for (const label of recoveryLines) {
      if (!list.includes(label)) list.push(label);
    }
    details.set("recovery", list);
  }
  const headOrder = [
    ...HEADS_OF_LOSS.filter((head) => byHead.has(head)),
    ...money.heads.map((row) => row.head).filter((head) => !HEADS_OF_LOSS.includes(head as HeadOfLoss)),
  ];
  const charges: ClaimSummaryCharge[] = headOrder.map((head) => {
    const row = byHead.get(head)!;
    return {
      head,
      label: HEAD_LABELS[head as HeadOfLoss] || head,
      details: details.get(head) ?? [],
      claimed: formatGbp(row.claimedPence),
      offered: formatGbp(row.offeredPence),
      agreed: row.agreedPence > 0 ? formatGbp(row.agreedPence) : "—",
      received: formatGbp(row.receivedPence),
      outstanding: outstandingColumnText(row),
      overpaid: row.overpaidPence > 0 ? formatGbp(row.overpaidPence) : "—",
      reviewNote: figureUnderReviewNote(id, head, row.claimedPence),
    };
  });
  const running = claimRunningDaily(id);
  const conflict = fleetConflictForClaim(id);
  const flags: ClaimSummaryFlag[] = [
    ...outstandingForClaim(id).map((item) => ({
      id: item.id,
      href: flagHref(id, item.id),
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
    ...recoveryReviewFlags(id).map((label, index) => ({
      id: `recovery-review-${index}`,
      href: `/claims/${id}/heads/recovery`,
      label,
    })),
  ];
  const due = dueWording(displayed.dueAt);
  const registration = claim.registration ? formatVehicleRegistration(String(claim.registration)) : "Not recorded";

  return {
    reference: String(claim.file_reference),
    client: String(claim.client_name || "Unknown client"),
    registration,
    handler: String(claim.handler_name || "Unassigned"),
    insurerLine: `${insurerName || "Insurer not recorded"}${insurerRef ? ` · ${insurerRef}` : ""}`,
    statusLine: `${liabilityStatusLabel(String(claim.claim_type))} · ${roadworthinessLabel(String(claim.roadworthiness))} · Insurer ${storedLabel(claim.insurer_liability_position ? String(claim.insurer_liability_position) : "", INSURER_POSITION)}`,
    stageLine: current ? `${current.title} · ${current.state === "done" ? "Done" : current.state === "in_progress" ? "In progress" : current.state === "waiting" ? "Waiting" : current.state === "not_needed" ? "Not needed" : "Not started"}` : "Not started",
    runningText:
      running.dailyPence > 0
        ? `${formatGbp(running.dailyPence)}/day running`
        : running.rateMissing
          ? "Charges still running — no daily rate on the file"
          : "No hire or storage charge running",
    runningDaily: runningDailyLabel(running),
    charges,
    outstandingTotal: formatGbp(confirmedOutstandingPence(money.confirmed.outstandingPence)),
    nextAction: displayed.action || "None set",
    dueText: displayed.dueAt ? due.text : "No due date",
    dueClass: displayed.dueAt ? dueTextClass(due.tone) : "",
    flags,
    conflict: conflict ? conflict.text : null,
  };
}
