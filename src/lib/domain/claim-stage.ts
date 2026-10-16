/** The stage line on a claim. The highlighted step comes from what is already stored. */

export function claimStageSteps(totalLoss: boolean): string[] {
  return ["Enquiry", "Recovery", "Engineer", "Liability", totalLoss ? "Total loss" : "Repair", "Settlement", "Closed"];
}

export function currentClaimStage(input: {
  closed: boolean;
  totalLoss: boolean;
  position: string;
  repairStatus: string;
  repairsComplete: boolean;
  engineeringStatus: string;
  recoveryStatus: string;
  needsRecovery: boolean;
}): string {
  const position = input.position || "";
  if (input.closed) return "Closed";
  if (/payment|settlement|litigation|offer/i.test(position)) return "Settlement";
  if (input.totalLoss) return "Total loss";
  const repair = input.repairStatus;
  if (
    input.repairsComplete ||
    repair === "in_progress" ||
    repair === "awaiting_return" ||
    repair === "awaiting_authorisation" ||
    repair === "awaiting_auth" ||
    repair === "authorised" ||
    repair === "complete" ||
    /repair/i.test(position)
  ) {
    return "Repair";
  }
  const engineerDone = /report_received|complete/.test(input.engineeringStatus);
  if (/liability/i.test(position) && engineerDone) return "Liability";
  if (input.engineeringStatus || /engineer/i.test(position)) return "Engineer";
  if (/liability/i.test(position)) return "Liability";
  if (input.recoveryStatus || input.needsRecovery || /recovery|storage/i.test(position)) return "Recovery";
  return "Enquiry";
}
