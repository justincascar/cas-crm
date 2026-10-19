import { formatUkDate } from "../dates";
import { formatGbp } from "../money";
import { dispatchFromHistoryNote } from "./justification-chronology";

/**
 * The ten steps on a claim, read from history.
 * Nothing here writes a status, a date, or an event.
 *
 * Fault claims: which steps apply is a proposal, waiting for Justin to confirm.
 * It is not a confirmed rule.
 */

export const CLAIM_STEP_KEYS = [
  "details",
  "recovery",
  "hire",
  "initial_letter",
  "engineer",
  "engineer_report",
  "agree",
  "send_report",
  "finish",
  "payments",
] as const;

export type ClaimStepKey = (typeof CLAIM_STEP_KEYS)[number];

export type ClaimStepState = "done" | "in_progress" | "waiting" | "not_started" | "not_needed";

export type ClaimStepEvent = {
  event_type: string;
  occurred_at: string;
  details: string | null;
};

export type ClaimStepChase = {
  kind: string;
  active: boolean;
  due: boolean;
  outcomeOnFile: boolean;
  intervalDays: number;
  dueAt: string | null;
  handlerState: string;
};

export type ClaimPaymentLineInput = {
  key: "repairs" | "recovery" | "storage" | "hire";
  label: string;
  /** False when hire or storage still has no confirmed end. Null when this charge has no end date. */
  endConfirmed: boolean | null;
  chargeRecorded: boolean;
  requestSent: boolean;
  intervalDays: number | null;
  receivedPence: number;
  paidInFull: boolean;
  partPaid: boolean;
};

export type ClaimStepInput = {
  claimId: string;
  claimType: string;
  roadworthiness: string;
  needsReplacement: boolean;
  needsRecovery: boolean;
  createdAt: string | null;
  clientName: string;
  accidentAt: string | null;
  registration: string;
  /** True when this file's liability already says which insurer the letter goes to. */
  insurerExpected: boolean;
  insurerName: string;
  totalLoss: boolean;
  hasHireEvidence: boolean;
  prehireDone: boolean;
  vehicleChosen: boolean;
  agreementDone: boolean;
  dailyRatePence: number | null;
  recoveryFlagComplete: boolean;
  storageEndedOn: string | null;
  hireEndedOn: string | null;
  salvageRecorded: boolean;
  qualifyingOffHireOn: string | null;
  events: ClaimStepEvent[];
  chases: ClaimStepChase[];
  payments: ClaimPaymentLineInput[];
};

export type ClaimStepLine = { label: string; date: string };

export type ClaimStepView = {
  key: ClaimStepKey;
  title: string;
  state: ClaimStepState;
  statusText: string;
  detail: string | null;
  lines: ClaimStepLine[];
  historyLines: ClaimStepLine[];
  buttonLabel: string | null;
  buttonHref: string | null;
  buttonForm: "report" | "agree" | null;
  detailsHref: string;
  progressDone: number | null;
  progressTotal: number | null;
  missingCount: number;
  missingHref: string | null;
};

export type DisplayedNextAction = {
  action: string;
  dueAt: string | null;
  fromStaff: boolean;
};

/**
 * Proposed for a fault claim. Not confirmed.
 * 1 Basic details — applies.
 * 2 Recovery or collection — applies, and is not needed when the vehicle is roadworthy.
 * 3 Hire — applies when the client needs a car. It is courtesy, not credit hire.
 * 4 The third-party letter does not apply. The letter to the client's own insurer does.
 * 5 Instruct engineer — applies.
 * 6 Engineer's report — applies.
 * 7 Agree the repair estimate, or the valuation on a total loss — applies.
 * 8 Sending the report to the third-party insurer does not apply.
 * 9 Repairs and return, or total-loss payment and salvage — applies.
 * 10 Payments — applies for a charge that is on the file.
 */
export const FAULT_STEP_PROPOSAL = [
  "Basic details captured — applies.",
  "Recovery or collection — applies. Not needed when the vehicle is roadworthy.",
  "Hire vehicle — applies when the client needs a car. Fault courtesy is not credit hire. Not needed when the client does not need a car.",
  "Initial letter to the third-party insurer — not needed. The letter to the client's own insurer applies instead.",
  "Instruct engineer — applies.",
  "Engineer's report received — applies.",
  "Agree the repair estimate with the client, or the valuation on a total loss — applies.",
  "Send the report and estimate to the third-party insurer — not needed.",
  "Repairs and return, or payment and salvage on a total loss — applies.",
  "Payments — applies for each charge on the file.",
] as const;

function latest(events: ClaimStepEvent[], type: string): ClaimStepEvent | null {
  let found: ClaimStepEvent | null = null;
  for (const event of events) {
    if (event.event_type !== type) continue;
    if (!found || event.occurred_at > found.occurred_at) found = event;
  }
  return found;
}

function uk(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const text = formatUkDate(iso);
  return text === "Unknown" ? null : text;
}

function doneText(iso: string | null, extra?: string | null): string {
  const date = uk(iso);
  const base = date ? `Done · ${date}` : "Done";
  return extra ? `${base} · ${extra}` : base;
}

function chaseFor(chases: ClaimStepChase[], kind: string): ClaimStepChase | null {
  return chases.find((chase) => chase.kind === kind) || null;
}

function chasePhrase(chase: ClaimStepChase | null): string | null {
  if (!chase || chase.outcomeOnFile || chase.handlerState === "cancelled") return null;
  if (!chase.active && !chase.due) return null;
  if (chase.handlerState === "paused") return "Chase paused";
  const next = uk(chase.dueAt);
  const days = chase.intervalDays;
  const every = `chasing every ${days} ${days === 1 ? "day" : "days"}`;
  return next ? `${every}, next ${next}` : every;
}

function notNeeded(events: ClaimStepEvent[], key: ClaimStepKey): { reason: string; at: string } | null {
  const marker = `Step ${key} marked not needed.`;
  let found: ClaimStepEvent | null = null;
  for (const event of events) {
    if (event.event_type !== "step_not_needed") continue;
    if (!(event.details || "").includes(marker)) continue;
    if (!found || event.occurred_at > found.occurred_at) found = event;
  }
  if (!found) return null;
  const reason = (found.details || "").split("Reason:")[1]?.trim() || "";
  if (!reason) return null;
  return { reason, at: found.occurred_at };
}

function letterWords(event: ClaimStepEvent): string {
  const details = event.details || "";
  if (/simulated/i.test(details)) return "Simulated send";
  if (dispatchFromHistoryNote(details) === "generated") return "Generated, not sent";
  if (dispatchFromHistoryNote(details) === "sent") return "Marked as sent";
  return "Recorded on the file";
}

/** A mailbox simulation, or a generated draft, is not a send. A hand record on the file is. */
function reportSendCounts(event: ClaimStepEvent | null): boolean {
  if (!event) return false;
  const details = event.details || "";
  if (dispatchFromHistoryNote(details) === "generated") return false;
  if (/simulated send/i.test(details) || /email sending is simulated/i.test(details)) return false;
  return true;
}

function reportSendWords(event: ClaimStepEvent): string {
  const details = event.details || "";
  if (/not a live send/i.test(details) || /not auto-sent/i.test(details)) return "Not a live send";
  if (dispatchFromHistoryNote(details) === "sent") return "Marked as sent";
  return "Recorded on the file";
}

function blank(value: string | null | undefined): boolean {
  const text = String(value || "").trim();
  return !text || text === "Unknown" || text === "Unknown client";
}

function isFault(claimType: string): boolean {
  return claimType === "fault";
}

function path(claimId: string, suffix: string): string {
  return suffix ? `/claims/${claimId}/${suffix}` : `/claims/${claimId}`;
}

function line(label: string, iso: string | null | undefined): ClaimStepLine | null {
  const date = uk(iso);
  if (!date) return null;
  return { label, date };
}

function paymentText(row: ClaimPaymentLineInput): string {
  if ((row.key === "hire" || row.key === "storage") && row.endConfirmed === false) {
    return "Not ready (end date not confirmed)";
  }
  if (row.paidInFull) return "Paid in full";
  if (row.partPaid) return `Part paid ${formatGbp(Math.max(0, row.receivedPence))}`;
  if (row.requestSent && row.intervalDays) {
    const days = row.intervalDays;
    return `Payment request sent, chasing every ${days} ${days === 1 ? "day" : "days"}`;
  }
  if (row.key === "recovery" && row.chargeRecorded) return "Figure final. No payment request recorded.";
  return "Not started";
}

export function deriveClaimSteps(input: ClaimStepInput): ClaimStepView[] {
  const fault = isFault(input.claimType);
  const base = path(input.claimId, "");
  const events = input.events;
  const opened = latest(events, "file_opened");
  const recoveryEvent = latest(events, "recovery_completed");
  const hireStarted = latest(events, "hire_started");
  const tpLetter = latest(events, "initial_letter_tp_insurer");
  const ownLetter = latest(events, "initial_letter_own_insurer");
  const instructed = latest(events, "engineer_instructed");
  const report = latest(events, "engineer_report_received");
  const reportCleared = latest(events, "engineer_report_received_cleared");
  const reportOnFile =
    report &&
    (!reportCleared || report.occurred_at >= reportCleared.occurred_at) &&
    (!instructed || report.occurred_at >= instructed.occurred_at)
      ? report
      : null;
  const agreedRepair = latest(events, "repair_estimate_agreed_with_client");
  const agreedValuation = latest(events, "total_loss_agreed_confirmed");
  const reportSent = latest(events, "engineer_report_sent_to_insurer");
  const valuationSent = latest(events, "total_loss_notice_sent");
  const repairsStarted = latest(events, "repairs_started");
  const repairsComplete = latest(events, "repairs_complete");
  const returned = latest(events, "vehicle_returned");
  const hireEndedEvent = latest(events, "hire_ended");
  const storageEndedEvent = latest(events, "storage_ended");
  const paymentReceived = latest(events, "total_loss_payment_received");

  const missing: string[] = [];
  if (blank(input.clientName)) missing.push("client name");
  if (!input.accidentAt) missing.push("accident date");
  if (blank(input.registration)) missing.push("registration");
  if (input.insurerExpected && blank(input.insurerName)) missing.push("insurer");

  const detailsDate = opened?.occurred_at || input.createdAt;
  const details: ClaimStepView = {
    key: "details",
    title: "Basic details captured",
    state: "done",
    statusText: doneText(detailsDate),
    detail: null,
    lines: [],
    historyLines: [],
    buttonLabel: missing.length ? "Open details" : null,
    buttonHref: missing.length ? path(input.claimId, "details") : null,
    buttonForm: null,
    detailsHref: path(input.claimId, "details"),
    progressDone: null,
    progressTotal: null,
    missingCount: missing.length,
    missingHref: missing.length ? path(input.claimId, "details") : null,
  };

  const steps: ClaimStepView[] = [details];
  steps.push(recoveryStep());
  steps.push(hireStep());
  steps.push(letterStep());
  steps.push(engineerStep());
  steps.push(reportStep());
  steps.push(agreeStep());
  steps.push(sendStep());
  steps.push(finishStep());
  steps.push(paymentsStep());
  return steps;

  function applyNotNeeded(key: ClaimStepKey, view: ClaimStepView): ClaimStepView {
    if (view.state === "done") return view;
    const marked = notNeeded(events, key);
    if (!marked) return view;
    return {
      ...view,
      state: "not_needed",
      statusText: `Not needed. ${marked.reason}`,
      detail: null,
      buttonLabel: null,
      buttonHref: null,
      buttonForm: null,
    };
  }

  function recoveryStep(): ClaimStepView {
    const href = path(input.claimId, "money/recovery");
    let view: ClaimStepView = {
      key: "recovery",
      title: "Recovery or collection",
      state: "not_started",
      statusText: "Not started",
      detail: null,
      lines: [],
      historyLines: [],
      buttonLabel: "Record recovery",
      buttonHref: href,
      buttonForm: null,
      detailsHref: href,
      progressDone: null,
      progressTotal: null,
      missingCount: 0,
      missingHref: null,
    };
    if (recoveryEvent) {
      view = { ...view, state: "done", statusText: doneText(recoveryEvent.occurred_at), buttonLabel: null, buttonHref: null };
    } else if (input.roadworthiness === "roadworthy") {
      view = {
        ...view,
        state: "not_needed",
        statusText: "Not needed. The vehicle is roadworthy.",
        buttonLabel: null,
        buttonHref: null,
      };
    } else if (input.recoveryFlagComplete) {
      view = {
        ...view,
        state: "not_started",
        statusText: "Not started",
        detail: "Cannot tell from the history. No recovery event is on the file.",
      };
    } else if (input.roadworthiness === "unroadworthy" || input.needsRecovery) {
      view = { ...view, state: "in_progress", statusText: "In progress" };
    }
    return applyNotNeeded("recovery", view);
  }

  function hireStep(): ClaimStepView {
    const href = path(input.claimId, "hire");
    const checks = [input.prehireDone, input.vehicleChosen, input.agreementDone, Boolean(hireStarted)];
    const progressDone = checks.filter(Boolean).length;
    let view: ClaimStepView = {
      key: "hire",
      title: "Hire vehicle",
      state: "in_progress",
      statusText: "In progress",
      detail: null,
      lines: [],
      historyLines: [],
      buttonLabel: "Arrange hire",
      buttonHref: href,
      buttonForm: null,
      detailsHref: href,
      progressDone: hireStarted ? null : progressDone,
      progressTotal: hireStarted ? null : 4,
      missingCount: 0,
      missingHref: null,
    };
    if (hireStarted) {
      const rate = input.dailyRatePence && input.dailyRatePence > 0 ? `${formatGbp(input.dailyRatePence)}/day` : null;
      const since = uk(hireStarted.occurred_at);
      view = {
        ...view,
        state: "done",
        statusText: doneText(hireStarted.occurred_at),
        detail: since ? `On hire since ${since}${rate ? `, ${rate}` : ""}` : rate,
        buttonLabel: null,
        buttonHref: null,
        progressDone: null,
        progressTotal: null,
      };
    } else if (!input.needsReplacement && !input.hasHireEvidence) {
      view = {
        ...view,
        state: "not_needed",
        statusText: "Not needed. The client does not need a replacement vehicle.",
        detail: null,
        buttonLabel: null,
        buttonHref: null,
        progressDone: null,
        progressTotal: null,
      };
    }
    return applyNotNeeded("hire", view);
  }

  function letterStep(): ClaimStepView {
    const href = path(input.claimId, "messages");
    const event = fault ? ownLetter : tpLetter;
    const chase = chasePhrase(chaseFor(input.chases, "liability_response"));
    let view: ClaimStepView = {
      key: "initial_letter",
      title: fault ? "Initial letter to the client's own insurer" : "Initial letter to the third-party insurer",
      state: "in_progress",
      statusText: "In progress",
      detail: null,
      lines: [],
      historyLines: [],
      buttonLabel: "Send letter",
      buttonHref: href,
      buttonForm: null,
      detailsHref: href,
      progressDone: null,
      progressTotal: null,
      missingCount: 0,
      missingHref: null,
    };
    if (event) {
      const words = letterWords(event);
      view = {
        ...view,
        state: "done",
        statusText: doneText(event.occurred_at, words),
        detail: chase ? `Waiting on the insurer, ${chase}` : null,
        buttonLabel: null,
        buttonHref: null,
      };
    }
    return applyNotNeeded("initial_letter", view);
  }

  function engineerStep(): ClaimStepView {
    const href = path(input.claimId, "messages");
    let view: ClaimStepView = {
      key: "engineer",
      title: "Instruct engineer",
      state: "in_progress",
      statusText: "In progress",
      detail: null,
      lines: [],
      historyLines: [],
      buttonLabel: "Instruct",
      buttonHref: href,
      buttonForm: null,
      detailsHref: href,
      progressDone: null,
      progressTotal: null,
      missingCount: 0,
      missingHref: null,
    };
    if (instructed) {
      const words = letterWords(instructed);
      view = {
        ...view,
        state: "done",
        statusText: doneText(instructed.occurred_at, words),
        buttonLabel: null,
        buttonHref: null,
      };
    }
    return applyNotNeeded("engineer", view);
  }

  function reportStep(): ClaimStepView {
    const chase = chasePhrase(chaseFor(input.chases, "engineer_report"));
    let view: ClaimStepView = {
      key: "engineer_report",
      title: "Engineer's report received",
      state: "not_started",
      statusText: "Not started",
      detail: null,
      lines: [],
      historyLines: [],
      buttonLabel: instructed ? "Record report received" : null,
      buttonHref: null,
      buttonForm: instructed ? "report" : null,
      detailsHref: path(input.claimId, "documents"),
      progressDone: null,
      progressTotal: null,
      missingCount: 0,
      missingHref: null,
    };
    if (reportOnFile) {
      view = {
        ...view,
        state: "done",
        statusText: doneText(reportOnFile.occurred_at),
        buttonLabel: null,
        buttonForm: null,
      };
    } else if (instructed) {
      view = {
        ...view,
        state: "waiting",
        statusText: chase ? `Waiting on the engineer, ${chase}` : "Waiting on the engineer",
      };
    }
    return applyNotNeeded("engineer_report", view);
  }

  function agreeStep(): ClaimStepView {
    const title = input.totalLoss ? "Agree valuation with the client" : "Agree repair estimate with the client";
    const event = input.totalLoss ? agreedValuation : agreedRepair;
    const href = input.totalLoss ? path(input.claimId, "details/assessed-damage") : null;
    let view: ClaimStepView = {
      key: "agree",
      title,
      state: "not_started",
      statusText: "Not started",
      detail: input.totalLoss
        ? null
        : "No history event records that the repair estimate was agreed with the client.",
      lines: [],
      historyLines: [],
      buttonLabel: input.totalLoss ? "Agree valuation" : "Record agreement",
      buttonHref: href,
      buttonForm: input.totalLoss ? null : "agree",
      detailsHref: input.totalLoss ? path(input.claimId, "details/assessed-damage") : `${base}#agree-estimate`,
      progressDone: null,
      progressTotal: null,
      missingCount: 0,
      missingHref: null,
    };
    if (event) {
      view = {
        ...view,
        state: "done",
        statusText: doneText(event.occurred_at),
        detail: null,
        buttonLabel: null,
        buttonHref: null,
        buttonForm: null,
      };
    }
    return applyNotNeeded("agree", view);
  }

  function sendStep(): ClaimStepView {
    const href = input.totalLoss ? path(input.claimId, "messages") : path(input.claimId, "documents");
    if (fault && !input.totalLoss) {
      return applyNotNeeded("send_report", {
        key: "send_report",
        title: "Send report and estimate to the third-party insurer",
        state: "not_needed",
        statusText: "Not needed. Fault claim: the report is not sent to a third-party insurer. This is proposed, and is waiting for confirmation.",
        detail: null,
        lines: [],
        historyLines: [],
        buttonLabel: null,
        buttonHref: null,
        buttonForm: null,
        detailsHref: href,
        progressDone: null,
        progressTotal: null,
        missingCount: 0,
        missingHref: null,
      });
    }
    const event = input.totalLoss ? valuationSent : reportSent;
    const counts = input.totalLoss ? Boolean(valuationSent) : reportSendCounts(reportSent);
    const chase = chasePhrase(
      chaseFor(input.chases, input.totalLoss ? "settlement_payment" : "repair_authorisation"),
    );
    let view: ClaimStepView = {
      key: "send_report",
      title: input.totalLoss ? "Send valuation to the insurer" : "Send report and estimate to the third-party insurer",
      state: reportOnFile || input.totalLoss ? "in_progress" : "not_started",
      statusText: reportOnFile || input.totalLoss ? "In progress" : "Not started",
      detail: null,
      lines: [],
      historyLines: [],
      buttonLabel: input.totalLoss ? "Send valuation" : "Send report",
      buttonHref: href,
      buttonForm: null,
      detailsHref: href,
      progressDone: null,
      progressTotal: null,
      missingCount: 0,
      missingHref: null,
    };
    if (event && counts) {
      view = {
        ...view,
        state: "done",
        statusText: doneText(event.occurred_at, input.totalLoss ? letterWords(event) : reportSendWords(event)),
        detail: chase ? `Waiting on the insurer, ${chase}` : null,
        buttonLabel: null,
        buttonHref: null,
      };
    } else if (event && !counts) {
      view = {
        ...view,
        detail: "A simulated or generated item is on the file. It is not treated as sent.",
      };
    }
    return applyNotNeeded("send_report", view);
  }

  function finishStep(): ClaimStepView {
    const repairLines = [
      line("Repairs started", repairsStarted?.occurred_at),
      line("Repairs complete", repairsComplete?.occurred_at),
      line("Car returned to client", returned?.occurred_at),
      line("Hire ended", hireEndedEvent?.occurred_at || input.hireEndedOn),
      line("Storage ended", storageEndedEvent?.occurred_at || input.storageEndedOn),
    ].filter((item): item is ClaimStepLine => Boolean(item));
    if (input.totalLoss) {
      const lines = [
        line("Payment received", paymentReceived?.occurred_at),
        line("Hire end confirmed", input.qualifyingOffHireOn),
      ].filter((item): item is ClaimStepLine => Boolean(item));
      let view: ClaimStepView = {
        key: "finish",
        title: "Payment received and salvage collected",
        state: "not_started",
        statusText: "Not started",
        detail: input.salvageRecorded ? null : "Salvage collection is not on the history.",
        lines,
        historyLines: repairLines,
        buttonLabel: null,
        buttonHref: path(input.claimId, "money/vehicle"),
        buttonForm: null,
        detailsHref: path(input.claimId, "money/vehicle"),
        progressDone: null,
        progressTotal: null,
        missingCount: 0,
        missingHref: null,
      };
      if (paymentReceived && input.salvageRecorded) {
        view = { ...view, state: "done", statusText: doneText(paymentReceived.occurred_at), detail: null, buttonHref: null };
      } else if (paymentReceived) {
        view = { ...view, state: "waiting", statusText: "Waiting on salvage collection" };
      } else if (valuationSent) {
        view = { ...view, state: "waiting", statusText: "Waiting on the insurer" };
      }
      return applyNotNeeded("finish", view);
    }
    const href = path(input.claimId, "documents");
    let view: ClaimStepView = {
      key: "finish",
      title: "Repairs done and car returned",
      state: "not_started",
      statusText: "Not started",
      detail: null,
      lines: repairLines,
      historyLines: [],
      buttonLabel: "Record workshop step",
      buttonHref: href,
      buttonForm: null,
      detailsHref: href,
      progressDone: null,
      progressTotal: null,
      missingCount: 0,
      missingHref: null,
    };
    if (returned) {
      view = { ...view, state: "done", statusText: doneText(returned.occurred_at), buttonLabel: null, buttonHref: null };
    } else if (repairsComplete) {
      view = { ...view, state: "waiting", statusText: "Waiting on the car being returned" };
    } else if (repairsStarted) {
      view = { ...view, state: "in_progress", statusText: "In progress" };
    }
    return applyNotNeeded("finish", view);
  }

  function paymentsStep(): ClaimStepView {
    const lines = input.payments.map((row) => ({ label: row.label, date: paymentText(row) }));
    const href = path(input.claimId, "messages");
    return applyNotNeeded("payments", {
      key: "payments",
      title: "Payments",
      state: lines.every((row) => row.date === "Paid in full" || row.date === "Not started") && lines.some((row) => row.date === "Paid in full")
        ? "done"
        : lines.some((row) => row.date.startsWith("Payment request") || row.date.startsWith("Part paid") || row.date.startsWith("Not ready"))
          ? "in_progress"
          : "not_started",
      statusText: "See each charge",
      detail: null,
      lines,
      historyLines: [],
      buttonLabel: "Send payment request",
      buttonHref: href,
      buttonForm: null,
      detailsHref: path(input.claimId, "money"),
      progressDone: null,
      progressTotal: null,
      missingCount: 0,
      missingHref: null,
    });
  }
}

export function currentClaimStep(steps: ClaimStepView[]): ClaimStepView {
  return (
    steps.find((step) => step.state === "waiting" || step.state === "in_progress") ||
    steps.find((step) => step.state === "not_started") ||
    steps[steps.length - 1]
  );
}

/** Staff text on the file is kept. The step supplies the next action only when that text is empty. */
export function resolveDisplayedNextAction(input: {
  storedAction: string | null | undefined;
  storedDue: string | null | undefined;
  steps: ClaimStepView[];
}): DisplayedNextAction {
  const stored = String(input.storedAction || "").trim();
  if (stored) {
    return { action: stored, dueAt: input.storedDue ? String(input.storedDue) : null, fromStaff: true };
  }
  const step = currentClaimStep(input.steps);
  const action = step.buttonLabel || step.title;
  return { action, dueAt: null, fromStaff: false };
}

export function isClaimStepKey(value: string): value is ClaimStepKey {
  return (CLAIM_STEP_KEYS as readonly string[]).includes(value);
}
