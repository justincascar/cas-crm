import { formatUkDate } from "../dates";
import { formatGbp } from "../money";
import { hireNeedReason, NOT_YET_OWN_CAR, parseHireNeed } from "./hire-availability";
import { dispatchFromHistoryNote } from "./justification-chronology";

/**
 * The steps on a claim, read from history.
 * Nothing here writes a status, a date, or an event.
 *
 * Fault steps were confirmed by Justin on 21 October 2026.
 * A repairable non-fault file uses the repairable list.
 * A total loss uses the total-loss list. History already written stays on the file.
 */

export const CLAIM_STEP_KEYS = [
  "details",
  "recovery",
  "hire",
  "initial_letter",
  "engineer",
  "engineer_report",
  "send_report",
  "repair_authorisation",
  "agree",
  "finish",
  "payments",
  "own_insurer",
  "audatex_send",
  "audatex_auth",
  "repairs",
  "excess",
  "return_car",
  "fault_invoice",
] as const;

export type ClaimStepKey = (typeof CLAIM_STEP_KEYS)[number];

export type ClaimStepState =
  | "done"
  | "in_progress"
  | "waiting"
  | "not_started"
  | "to_do"
  | "not_needed"
  | "not_decided";

export type ClaimStepForm =
  | "report"
  | "route"
  | "audatex_sent"
  | "audatex_received"
  | "audatex_auth"
  | "excess"
  | "return"
  | "invoice"
  | "invoice_paid"
  | "own_insurer"
  | "engineer_instructed"
  | "report_sent"
  | "authorisation"
  | "repairs_started"
  | "repairs_complete"
  | "car_returned"
  | "hire_end"
  | "storage_end"
  | "tl_off_hire";

/** A date the CRM proposes for a handler to confirm, with a short reason. */
export type ClaimStepProposal = { day: string; note: string };

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
  endConfirmed: boolean | null;
  chargeRecorded: boolean;
  requestSent: boolean;
  intervalDays: number | null;
  receivedPence: number;
  paidInFull: boolean;
  partPaid: boolean;
};

export type AudatexReduction = { pence: number | null; note: string | null };

export type AudatexFacts = {
  reference: string | null;
  estimatePence: number | null;
  labourPence: number | null;
  partsPence: number | null;
  paintPence: number | null;
  authorisedPence: number | null;
  hourly: AudatexReduction;
  times: AudatexReduction;
  partsReduction: AudatexReduction;
  other: AudatexReduction;
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
  insurerExpected: boolean;
  insurerName: string;
  totalLoss: boolean;
  hasHireEvidence: boolean;
  prehireDone: boolean;
  vehicleChosen: boolean;
  agreementDone: boolean;
  dailyRatePence: number | null;
  recoveryFlagComplete: boolean;
  /** Engineering status says the report is in, with no report event. */
  reportFlagged?: boolean;
  /** Storage is on the file (a start, an end date, or a status other than none). */
  storageOnFile?: boolean;
  storageEndedOn: string | null;
  hireEndedOn: string | null;
  salvageRecorded: boolean;
  qualifyingOffHireOn: string | null;
  /** Repairable hire: the day the hire car was collected, waiting for a handler to confirm it as the hire end. */
  hireEndProposedOn?: string | null;
  /** Storage end proposed from repair authorisation or repairs started, waiting for a handler. */
  storageEndProposal?: ClaimStepProposal | null;
  /** Total loss: 7 days after the qualifying payment, or the reasons a person must review first. */
  offHire?: { day: string | null; reasons: string[] } | null;
  audatex?: AudatexFacts | null;
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
  forms: ClaimStepForm[];
  proposals: Partial<Record<ClaimStepForm, ClaimStepProposal>>;
  detailsHref: string;
  progressDone: number | null;
  progressTotal: number | null;
  missingCount: number;
  missingHref: string | null;
  dueAt: string | null;
};

export type DisplayedNextAction = {
  action: string;
  dueAt: string | null;
  fromStaff: boolean;
  note: string | null;
};

export function stepStageLabel(step: ClaimStepView): string {
  if (step.state === "to_do") return "To do";
  if (step.state === "in_progress") return "In progress";
  if (step.state === "waiting") return "Waiting";
  if (step.state === "not_started") return "Not started";
  if (step.state === "not_decided") return "Not decided yet";
  if (step.state === "not_needed") return "Not needed";
  return "Done";
}

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

function chaseDue(chase: ClaimStepChase | null): string | null {
  if (!chase || chase.outcomeOnFile || chase.handlerState === "cancelled") return null;
  if (!chase.active && !chase.due) return null;
  return chase.dueAt;
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

/** The authorised figure and any reduction, as the handler typed them on step 8. */
function authorisationDetail(event: ClaimStepEvent): string | null {
  const details = event.details || "";
  const authorisedFor = /Authorised for (£[\d,]+\.\d{2})/.exec(details)?.[1];
  const reduced = /Reduction (£[\d,]+\.\d{2}): ([^.]+)\./.exec(details);
  const parts = [authorisedFor ? `Authorised ${authorisedFor}` : null, reduced ? `Reduced by ${reduced[1]}, ${reduced[2]}` : null].filter(Boolean);
  return parts.length ? `${parts.join(". ")}.` : null;
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

function moneyLine(label: string, pence: number | null | undefined): ClaimStepLine | null {
  if (pence == null || !Number.isFinite(pence)) return null;
  return { label, date: formatGbp(pence) };
}

function hireAnswer(events: ClaimStepEvent[]): "yes" | "no" | "not_yet" | null {
  return parseHireNeed(latest(events, "hire_decision")?.details);
}

function inspectionRoute(events: ClaimStepEvent[], instructed: boolean): "engineer" | "audatex" | "both" | null {
  const event = latest(events, "inspection_route_chosen");
  const details = event?.details || "";
  if (/Route: both/i.test(details)) return "both";
  if (/Route: audatex/i.test(details)) return "audatex";
  if (/Route: engineer/i.test(details)) return "engineer";
  if (instructed) return "engineer";
  return null;
}

function excessFrom(events: ClaimStepEvent[]): { pence: number; at: string; method: string } | null {
  const event = latest(events, "excess_paid");
  if (!event) return null;
  const details = event.details || "";
  const amount = details.match(/Amount pence: (\d+)/);
  const method = details.match(/Method: ([^.]+)/);
  if (!amount) return null;
  return { pence: Number(amount[1]), at: event.occurred_at, method: (method?.[1] || "").trim() };
}

function claimNumberFrom(events: ClaimStepEvent[]): string | null {
  const event = latest(events, "own_claim_number_recorded");
  if (!event) return null;
  const match = (event.details || "").match(/Claim number: (.+)$/);
  return match?.[1]?.trim() || null;
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

function audatexLines(facts: AudatexFacts | null | undefined, showAuthorised: boolean): ClaimStepLine[] {
  if (!facts) return [];
  const lines = [
    facts.reference ? { label: "Audatex reference", date: facts.reference } : null,
    moneyLine("Estimate", facts.estimatePence),
    moneyLine("Labour", facts.labourPence),
    moneyLine("Parts", facts.partsPence),
    moneyLine("Paint", facts.paintPence),
  ];
  if (showAuthorised) {
    lines.push(moneyLine("Authorised", facts.authorisedPence));
    if (facts.estimatePence != null && facts.authorisedPence != null) {
      lines.push({ label: "Difference", date: formatGbp(facts.estimatePence - facts.authorisedPence) });
    }
    const reductions: Array<[string, AudatexReduction]> = [
      ["Hourly rate reduction", facts.hourly],
      ["Repair time reduction", facts.times],
      ["Parts reduction", facts.partsReduction],
      ["Other reduction", facts.other],
    ];
    for (const [label, reduction] of reductions) {
      if (reduction.pence == null && !reduction.note) continue;
      const amount = reduction.pence == null ? "" : formatGbp(reduction.pence);
      const note = reduction.note ? (amount ? `${amount} · ${reduction.note}` : reduction.note) : amount;
      if (note) lines.push({ label, date: note });
    }
  }
  return lines.filter((item): item is ClaimStepLine => Boolean(item));
}

export function faultInvoicePence(authorisedPence: number | null, excessPence: number | null): number | null {
  if (authorisedPence == null || excessPence == null) return null;
  return Math.max(0, authorisedPence - excessPence);
}

export function deriveClaimSteps(input: ClaimStepInput): ClaimStepView[] {
  const fault = isFault(input.claimType);
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
  const agreedValuation = latest(events, "total_loss_agreed_confirmed");
  const reportSent = latest(events, "engineer_report_sent_to_insurer");
  const valuationSent = latest(events, "total_loss_notice_sent");
  const repairsStarted = latest(events, "repairs_started");
  const repairsComplete = latest(events, "repairs_complete");
  const returned = latest(events, "vehicle_returned");
  const hireEndedEvent = latest(events, "hire_ended");
  const storageEndedEvent = latest(events, "storage_ended");
  const storageStartedEvent = latest(events, "storage_started");
  const hireEndConfirmed = latest(events, "hire_end_date_confirmed");
  const storageEndConfirmed = latest(events, "storage_end_date_confirmed");
  const paymentReceived = latest(events, "total_loss_payment_received");
  const authorised = latest(events, "repairs_authorised");
  const audatexSent = latest(events, "audatex_estimate_sent");
  const audatexReceived = latest(events, "audatex_estimate_received");
  const audatexAuthorised = latest(events, "audatex_authorisation_recorded");
  const salvageEvent = latest(events, "salvage_collected");
  const invoiceSent = latest(events, "fault_invoice_sent");
  const invoicePaid = latest(events, "fault_invoice_paid");
  const route = inspectionRoute(events, Boolean(instructed));
  const hireChoice = hireAnswer(events);
  const excess = excessFrom(events);
  const ownClaimNumber = claimNumberFrom(events);
  const mode = input.totalLoss ? "total_loss" : fault ? "fault" : "repairable";

  const missing: string[] = [];
  if (blank(input.clientName)) missing.push("client name");
  if (!input.accidentAt) missing.push("accident date");
  if (blank(input.registration)) missing.push("registration");
  if (input.insurerExpected && blank(input.insurerName)) missing.push("insurer");

  const steps: ClaimStepView[] = [detailsStep()];
  steps.push(recoveryStep());
  steps.push(hireStep());
  if (mode === "fault") {
    steps.push(ownInsurerStep());
    steps.push(audatexSendStep());
    steps.push(audatexAuthStep());
    steps.push(repairsOnlyStep());
    steps.push(excessStep());
    steps.push(returnStep());
    steps.push(invoiceStep());
    return steps;
  }
  steps.push(letterStep());
  if (mode === "repairable") {
    steps.push(engineerChoiceStep());
    steps.push(receivedStep());
    steps.push(sendRepairStep());
    steps.push(authorisationStep());
  } else {
    steps.push(engineerInstructStep());
    steps.push(reportOnlyStep());
    steps.push(agreeValuationStep());
    steps.push(sendValuationStep());
  }
  steps.push(finishStep());
  steps.push(paymentsStep());
  return steps;

  function shell(partial: Omit<ClaimStepView, "lines" | "historyLines" | "forms" | "proposals" | "dueAt" | "progressDone" | "progressTotal" | "missingCount" | "missingHref" | "detail" | "buttonLabel" | "buttonHref"> & Partial<ClaimStepView>): ClaimStepView {
    return {
      detail: null,
      lines: [],
      historyLines: [],
      forms: [],
      proposals: {},
      progressDone: null,
      progressTotal: null,
      missingCount: 0,
      missingHref: null,
      dueAt: null,
      buttonLabel: null,
      buttonHref: null,
      ...partial,
    };
  }

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
      forms: [],
    };
  }

  function detailsStep(): ClaimStepView {
    const detailsDate = opened?.occurred_at || input.createdAt;
    return shell({
      key: "details",
      title: "Basic details",
      state: "done",
      statusText: doneText(detailsDate),
      buttonLabel: missing.length ? "Open details" : null,
      buttonHref: missing.length ? path(input.claimId, "details") : null,
      detailsHref: path(input.claimId, "details"),
      missingCount: missing.length,
      missingHref: missing.length ? path(input.claimId, "details") : null,
    });
  }

  function recoveryStep(): ClaimStepView {
    const href = path(input.claimId, "money/recovery");
    let view = shell({
      key: "recovery",
      title: "Recovery",
      state: "to_do",
      statusText: "To do",
      buttonLabel: "Record recovery",
      buttonHref: href,
      detailsHref: href,
    });
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
    } else if (!input.roadworthiness || input.roadworthiness === "unknown") {
      view = { ...view, state: "not_decided", statusText: "Not decided yet" };
    } else if (input.recoveryFlagComplete) {
      view = {
        ...view,
        state: "not_started",
        statusText: "Not started",
        detail: "Cannot tell from the history. Recovery is marked complete, and there is no recovery event.",
      };
    }
    return applyNotNeeded("recovery", view);
  }

  function hireStep(): ClaimStepView {
    const href = path(input.claimId, "hire");
    const courtesy = mode === "fault";
    const checks = [input.prehireDone, input.vehicleChosen, input.agreementDone, Boolean(hireStarted)];
    const begun = checks.filter(Boolean).length;
    let view = shell({
      key: "hire",
      title: courtesy ? "Courtesy car" : "Hire",
      state: "to_do",
      statusText: "To do",
      detail: courtesy ? "This is a courtesy car. There is no daily charge to an insurer." : null,
      buttonLabel: courtesy ? "Arrange courtesy car" : "Arrange hire",
      buttonHref: href,
      detailsHref: href,
    });
    if (hireStarted) {
      const since = uk(hireStarted.occurred_at);
      const rate = !courtesy && input.dailyRatePence && input.dailyRatePence > 0 ? `${formatGbp(input.dailyRatePence)}/day` : null;
      view = {
        ...view,
        state: "done",
        statusText: doneText(hireStarted.occurred_at),
        detail: courtesy
          ? "Courtesy car on the file. There is no daily charge to an insurer."
          : since
            ? `On hire since ${since}${rate ? `, ${rate}` : ""}`
            : rate,
        buttonLabel: null,
        buttonHref: null,
      };
    } else if (hireChoice === "no") {
      const reason = hireNeedReason(latest(events, "hire_decision")?.details);
      view = {
        ...view,
        state: "not_needed",
        statusText: reason
          ? `Not needed. ${reason}`
          : courtesy
            ? "Not needed. The client does not need a courtesy car."
            : "Not needed. The client does not need a replacement vehicle.",
        detail: null,
        buttonLabel: null,
        buttonHref: null,
      };
    } else if (hireChoice === "not_yet") {
      view = {
        ...view,
        state: "to_do",
        statusText: "To do",
        detail: NOT_YET_OWN_CAR,
        buttonLabel: courtesy ? "Arrange courtesy car" : "Arrange hire",
        buttonHref: href,
      };
    } else if (!input.needsReplacement && !input.hasHireEvidence && hireChoice !== "yes") {
      view = {
        ...view,
        state: "not_decided",
        statusText: "Not decided yet",
        detail: courtesy ? "This is a courtesy car. There is no daily charge to an insurer." : null,
      };
    } else if (begun > 0) {
      view = {
        ...view,
        state: "in_progress",
        statusText: "In progress",
        progressDone: begun,
        progressTotal: 4,
      };
    }
    return applyNotNeeded("hire", view);
  }

  function letterStep(): ClaimStepView {
    const href = path(input.claimId, "messages");
    const chase = chaseFor(input.chases, "liability_response");
    const phrase = chasePhrase(chase);
    let view = shell({
      key: "initial_letter",
      title: "Initial letter to the third-party insurer",
      state: "to_do",
      statusText: "To do",
      buttonLabel: "Send letter",
      buttonHref: href,
      detailsHref: href,
    });
    if (tpLetter) {
      view = {
        ...view,
        state: "done",
        statusText: doneText(tpLetter.occurred_at, letterWords(tpLetter)),
        detail: phrase ? `Waiting on the insurer, ${phrase}` : null,
        buttonLabel: null,
        buttonHref: null,
        dueAt: null,
      };
    }
    return applyNotNeeded("initial_letter", view);
  }

  function engineerChoiceStep(): ClaimStepView {
    const href = path(input.claimId, "messages");
    const wantsEngineer = route === "engineer" || route === "both";
    const wantsAudatex = route === "audatex" || route === "both";
    const engineerDone = !wantsEngineer || Boolean(instructed);
    const audatexDone = !wantsAudatex || Boolean(audatexSent);
    const total = (wantsEngineer ? 1 : 0) + (wantsAudatex ? 1 : 0);
    const doneCount = (wantsEngineer && instructed ? 1 : 0) + (wantsAudatex && audatexSent ? 1 : 0);
    let view = shell({
      key: "engineer",
      title: "Engineer and/or Audatex estimate",
      state: "to_do",
      statusText: "To do",
      buttonLabel: null,
      buttonHref: null,
      detailsHref: href,
      forms: ["route"],
      lines: audatexLines(audatexSent ? input.audatex : null, false),
    });
    if (!route) {
      return applyNotNeeded("engineer", view);
    }
    view = {
      ...view,
      forms: [
        ...(wantsEngineer && !instructed ? (["engineer_instructed"] as const) : []),
        ...(wantsAudatex && !audatexSent ? (["audatex_sent"] as const) : []),
      ],
      buttonLabel: null,
      buttonHref: null,
      detail: `Chosen: ${route === "both" ? "engineer and Audatex" : route === "audatex" ? "Audatex estimate" : "engineer"}.`,
    };
    if (engineerDone && audatexDone) {
      const when = [instructed?.occurred_at, audatexSent?.occurred_at].filter(Boolean).sort().at(-1) || null;
      view = { ...view, state: "done", statusText: doneText(when), buttonLabel: null, buttonHref: null, forms: [], progressDone: null, progressTotal: null };
    } else if (doneCount > 0) {
      view = { ...view, state: "in_progress", statusText: "In progress", progressDone: doneCount, progressTotal: total };
    }
    return applyNotNeeded("engineer", view);
  }

  function receivedStep(): ClaimStepView {
    const wantsEngineer = route === "engineer" || route === "both";
    const wantsAudatex = route === "audatex" || route === "both";
    const engineerIn = !wantsEngineer || Boolean(reportOnFile);
    const audatexIn = !wantsAudatex || Boolean(audatexReceived);
    const sentSomething = (wantsEngineer && instructed) || (wantsAudatex && audatexSent);
    const chase = chaseFor(input.chases, "engineer_report");
    const phrase = chasePhrase(chase);
    const who = wantsEngineer && wantsAudatex ? "the engineer and Audatex" : wantsAudatex ? "Audatex" : "the engineer";
    let view = shell({
      key: "engineer_report",
      title: "Report or estimate received",
      state: "not_started",
      statusText: "Not started",
      detailsHref: path(input.claimId, "documents"),
      lines: audatexLines(audatexReceived ? input.audatex : null, false),
    });
    if (!route) {
      return applyNotNeeded("engineer_report", view);
    }
    if (input.reportFlagged && wantsEngineer && !reportOnFile) {
      view = {
        ...view,
        detail: "Cannot tell from the history. The file is marked report received, and there is no report-received event.",
      };
      return applyNotNeeded("engineer_report", view);
    }
    if (engineerIn && audatexIn) {
      const when = [reportOnFile?.occurred_at, audatexReceived?.occurred_at].filter(Boolean).sort().at(-1) || null;
      view = { ...view, state: "done", statusText: doneText(when), forms: [] };
    } else if (sentSomething && ((wantsEngineer && reportOnFile) || (wantsAudatex && audatexReceived))) {
      view = {
        ...view,
        state: "in_progress",
        statusText: "In progress",
        forms: [
          ...(wantsEngineer && instructed && !reportOnFile ? (["report"] as const) : []),
          ...(wantsAudatex && audatexSent && !audatexReceived ? (["audatex_received"] as const) : []),
        ],
      };
    } else if (sentSomething) {
      view = {
        ...view,
        state: "waiting",
        statusText: phrase ? `Waiting on ${who}, ${phrase}` : `Waiting on ${who}`,
        dueAt: chaseDue(chase),
        forms: [
          ...(wantsEngineer && instructed ? (["report"] as const) : []),
          ...(wantsAudatex && audatexSent ? (["audatex_received"] as const) : []),
        ],
      };
    }
    return applyNotNeeded("engineer_report", view);
  }

  function sendRepairStep(): ClaimStepView {
    const href = path(input.claimId, "documents");
    const received = route ? receivedReady() : false;
    const counts = reportSendCounts(reportSent);
    let view = shell({
      key: "send_report",
      title: "Send the report and estimate to the third-party insurer",
      state: received ? "to_do" : "not_started",
      statusText: received ? "To do" : "Not started",
      detailsHref: href,
      forms: received ? ["report_sent"] : [],
    });
    if (reportSent && counts) {
      view = {
        ...view,
        state: "done",
        statusText: doneText(reportSent.occurred_at, reportSendWords(reportSent)),
        buttonLabel: null,
        buttonHref: null,
        forms: [],
      };
    } else if (reportSent && !counts) {
      view = { ...view, detail: "A simulated or generated item is on the file. It is not treated as sent." };
    }
    return applyNotNeeded("send_report", view);
  }

  function receivedReady(): boolean {
    const wantsEngineer = route === "engineer" || route === "both";
    const wantsAudatex = route === "audatex" || route === "both";
    if (!route) return false;
    if (wantsEngineer && !reportOnFile) return false;
    if (wantsAudatex && !audatexReceived) return false;
    return true;
  }

  function authorisationStep(): ClaimStepView {
    const href = path(input.claimId, "repair");
    const chase = chaseFor(input.chases, "repair_authorisation");
    const phrase = chasePhrase(chase);
    const sent = reportSent && reportSendCounts(reportSent);
    let view = shell({
      key: "repair_authorisation",
      title: "Repair authorisation or payment agreed by the insurer",
      state: sent ? "waiting" : "not_started",
      statusText: sent ? (phrase ? `Waiting on the insurer, ${phrase}` : "Waiting on the insurer") : "Not started",
      detailsHref: href,
      forms: sent ? ["authorisation"] : [],
      dueAt: sent ? chaseDue(chase) : null,
      lines: audatexLines(audatexAuthorised ? input.audatex : null, true),
    });
    if (authorised) {
      view = {
        ...view,
        state: "done",
        statusText: doneText(authorised.occurred_at),
        detail: authorisationDetail(authorised) || phrase,
        buttonLabel: null,
        buttonHref: null,
        forms: [],
        dueAt: null,
      };
    }
    return applyNotNeeded("repair_authorisation", view);
  }

  function engineerInstructStep(): ClaimStepView {
    const href = path(input.claimId, "messages");
    let view = shell({
      key: "engineer",
      title: "Instruct engineer",
      state: "to_do",
      statusText: "To do",
      buttonLabel: "Instruct",
      buttonHref: href,
      detailsHref: href,
    });
    if (instructed) {
      view = {
        ...view,
        state: "done",
        statusText: doneText(instructed.occurred_at, letterWords(instructed)),
        buttonLabel: null,
        buttonHref: null,
      };
    }
    return applyNotNeeded("engineer", view);
  }

  function reportOnlyStep(): ClaimStepView {
    const chase = chaseFor(input.chases, "engineer_report");
    const phrase = chasePhrase(chase);
    let view = shell({
      key: "engineer_report",
      title: "Engineer's report received",
      state: "not_started",
      statusText: "Not started",
      detailsHref: path(input.claimId, "documents"),
      forms: instructed ? ["report"] : [],
    });
    if (reportOnFile) {
      view = { ...view, state: "done", statusText: doneText(reportOnFile.occurred_at), forms: [] };
    } else if (input.reportFlagged) {
      view = {
        ...view,
        detail: "Cannot tell from the history. The file is marked report received, and there is no report-received event.",
        forms: instructed ? ["report"] : [],
      };
    } else if (instructed) {
      view = {
        ...view,
        state: "waiting",
        statusText: phrase ? `Waiting on the engineer, ${phrase}` : "Waiting on the engineer",
        dueAt: chaseDue(chase),
      };
    }
    return applyNotNeeded("engineer_report", view);
  }

  function agreeValuationStep(): ClaimStepView {
    const href = path(input.claimId, "details/assessed-damage");
    let view = shell({
      key: "agree",
      title: "Agree valuation with the client",
      state: "not_started",
      statusText: "Not started",
      buttonLabel: "Agree valuation",
      buttonHref: href,
      detailsHref: href,
    });
    if (agreedValuation) {
      view = { ...view, state: "done", statusText: doneText(agreedValuation.occurred_at), buttonLabel: null, buttonHref: null };
    } else if (reportOnFile || input.totalLoss) {
      view = { ...view, state: "to_do", statusText: "To do" };
    }
    return applyNotNeeded("agree", view);
  }

  function sendValuationStep(): ClaimStepView {
    const href = path(input.claimId, "messages");
    const chase = chaseFor(input.chases, "settlement_payment");
    const phrase = chasePhrase(chase);
    let view = shell({
      key: "send_report",
      title: "Send valuation to the insurer",
      state: "to_do",
      statusText: "To do",
      buttonLabel: "Send valuation",
      buttonHref: href,
      detailsHref: href,
    });
    if (valuationSent) {
      view = {
        ...view,
        state: "done",
        statusText: doneText(valuationSent.occurred_at, letterWords(valuationSent)),
        detail: phrase ? `Waiting on the insurer, ${phrase}` : null,
        buttonLabel: null,
        buttonHref: null,
      };
    }
    return applyNotNeeded("send_report", view);
  }

  function finishStep(): ClaimStepView {
    const repairLines = [
      line("Repairs started", repairsStarted?.occurred_at),
      line("Repairs complete", repairsComplete?.occurred_at),
      line("Car returned to client", returned?.occurred_at),
      line("Hire ended", hireEndedEvent?.occurred_at),
      line("Storage ended", storageEndedEvent?.occurred_at),
    ].filter((item): item is ClaimStepLine => Boolean(item));
    if (input.totalLoss) {
      const lines = [
        line("Payment received", paymentReceived?.occurred_at),
        line("Hire end confirmed", input.qualifyingOffHireOn),
        line("Salvage collected", salvageEvent?.occurred_at),
      ].filter((item): item is ClaimStepLine => Boolean(item));
      let view = shell({
        key: "finish",
        title: "Payment received and salvage collected",
        state: "not_started",
        statusText: "Not started",
        detail: salvageEvent ? null : "Salvage collection is not on the history.",
        lines,
        historyLines: repairLines,
        buttonHref: path(input.claimId, "money/vehicle"),
        detailsHref: path(input.claimId, "money/vehicle"),
      });
      if (hireStarted && !input.qualifyingOffHireOn && !hireEndConfirmed && input.offHire) {
        if (input.offHire.day) {
          view = {
            ...view,
            forms: ["tl_off_hire"],
            proposals: { tl_off_hire: { day: input.offHire.day, note: "7 days after the payment that settled the vehicle damage." } },
          };
        } else if (input.offHire.reasons.length) {
          view = { ...view, detail: `Hire end needs a person to review: ${input.offHire.reasons.join(" ")}` };
        }
      }
      if (paymentReceived && salvageEvent) {
        view = { ...view, state: "done", statusText: doneText(paymentReceived.occurred_at), detail: null, buttonHref: null };
      } else if (paymentReceived) {
        view = { ...view, state: "waiting", statusText: "Waiting on salvage collection" };
      } else if (valuationSent) {
        view = { ...view, state: "waiting", statusText: "Waiting on the insurer" };
      }
      return applyNotNeeded("finish", view);
    }
    const href = path(input.claimId, "repair");
    const hireApplies = Boolean(hireStarted);
    const storageApplies = Boolean(storageStartedEvent) || Boolean(input.storageOnFile);
    const hireOk = !hireApplies || Boolean(hireEndedEvent) || Boolean(hireEndConfirmed);
    const storageOk = !storageApplies || Boolean(storageEndedEvent) || Boolean(storageEndConfirmed);
    const authorisationSettled = Boolean(authorised) || Boolean(notNeeded(events, "repair_authorisation"));
    const forms: ClaimStepForm[] = [];
    if (!repairsStarted && authorisationSettled) forms.push("repairs_started");
    if (repairsStarted && !repairsComplete) forms.push("repairs_complete");
    if (repairsComplete && !returned) forms.push("car_returned");
    if (returned && hireApplies && !hireOk) forms.push("hire_end");
    if (storageApplies && !storageOk && input.storageEndProposal) forms.push("storage_end");
    const proposals: ClaimStepView["proposals"] = {};
    if (input.hireEndProposedOn) proposals.hire_end = { day: input.hireEndProposedOn, note: "The day the hire car was collected." };
    if (input.storageEndProposal) proposals.storage_end = input.storageEndProposal;
    let view = shell({
      key: "finish",
      title: "Repairs done and car returned",
      state: "not_started",
      statusText: "Not started",
      lines: [
        ...repairLines,
        line("Hire end confirmed", hireEndConfirmed?.occurred_at),
        line("Storage end confirmed", storageEndConfirmed?.occurred_at),
      ].filter((item): item is ClaimStepLine => Boolean(item)),
      detailsHref: href,
      forms,
      proposals,
    });
    if (!hireEndedEvent && input.hireEndedOn) {
      view = { ...view, detail: "Cannot tell from the history. Hire is marked ended, and there is no hire-ended event." };
    } else if (!storageEndedEvent && input.storageEndedOn) {
      view = { ...view, detail: "Cannot tell from the history. Storage is marked ended, and there is no storage-ended event." };
    }
    if (repairsComplete && returned && hireOk && storageOk) {
      view = { ...view, state: "done", statusText: doneText(returned.occurred_at), buttonLabel: null, buttonHref: null, forms: [] };
    } else if (repairsComplete && !returned) {
      view = { ...view, state: "waiting", statusText: "Waiting on the car being returned" };
    } else if (returned && !hireOk) {
      view = { ...view, state: "waiting", statusText: "Waiting on hire ending" };
    } else if (returned && !storageOk) {
      view = { ...view, state: "waiting", statusText: "Waiting on storage ending" };
    } else if (repairsStarted) {
      view = { ...view, state: "in_progress", statusText: "In progress" };
    }
    return applyNotNeeded("finish", view);
  }

  function paymentsStep(): ClaimStepView {
    const lines = input.payments.map((row) => ({ label: row.label, date: paymentText(row) }));
    const moving = lines.some((row) => row.date.startsWith("Payment request") || row.date.startsWith("Part paid"));
    const anyPaid = lines.some((row) => row.date === "Paid in full");
    const allSettled = lines.length > 0 && lines.every((row) => row.date === "Paid in full" || row.date === "Not started");
    return applyNotNeeded("payments", shell({
      key: "payments",
      title: "Payments",
      state: allSettled && anyPaid ? "done" : moving ? "in_progress" : "not_started",
      statusText: allSettled && anyPaid ? "Done" : moving ? "In progress" : "Not started",
      lines,
      buttonLabel: "Send payment request",
      buttonHref: path(input.claimId, "messages"),
      detailsHref: path(input.claimId, "money"),
    }));
  }

  function ownInsurerStep(): ClaimStepView {
    const href = path(input.claimId, "messages");
    let view = shell({
      key: "own_insurer",
      title: "Notify the client's own insurer",
      state: "to_do",
      statusText: "To do",
      buttonLabel: "Open messages",
      buttonHref: href,
      detailsHref: href,
      forms: ["own_insurer"],
    });
    if (ownLetter && ownClaimNumber) {
      view = {
        ...view,
        state: "done",
        statusText: doneText(ownLetter.occurred_at, letterWords(ownLetter)),
        detail: `Claim number ${ownClaimNumber}`,
        buttonLabel: null,
        buttonHref: null,
        forms: [],
      };
    } else if (ownLetter || ownClaimNumber) {
      view = {
        ...view,
        state: "in_progress",
        statusText: "In progress",
        detail: ownClaimNumber ? `Claim number ${ownClaimNumber}` : "The insurer has been notified. The claim number is not on the history yet.",
      };
    }
    return applyNotNeeded("own_insurer", view);
  }

  function audatexSendStep(): ClaimStepView {
    const view = shell({
      key: "audatex_send",
      title: "Send the Audatex estimate to the client's own insurer",
      state: audatexSent ? "done" : "to_do",
      statusText: audatexSent ? doneText(audatexSent.occurred_at) : "To do",
      detail: "There is no engineer on a fault claim.",
      detailsHref: path(input.claimId, "documents"),
      forms: audatexSent ? [] : ["audatex_sent"],
      lines: audatexLines(audatexSent ? input.audatex : null, false),
    });
    return applyNotNeeded("audatex_send", view);
  }

  function audatexAuthStep(): ClaimStepView {
    let view = shell({
      key: "audatex_auth",
      title: "Authorisation received via Audatex",
      state: audatexSent ? "waiting" : "not_started",
      statusText: audatexSent ? "Waiting on the insurer" : "Not started",
      detailsHref: path(input.claimId, "documents"),
      forms: audatexSent && !audatexAuthorised ? ["audatex_auth"] : [],
      lines: audatexLines(audatexAuthorised ? input.audatex : null, true),
    });
    if (audatexAuthorised) {
      view = { ...view, state: "done", statusText: doneText(audatexAuthorised.occurred_at), forms: [] };
    }
    return applyNotNeeded("audatex_auth", view);
  }

  function repairsOnlyStep(): ClaimStepView {
    const href = path(input.claimId, "repair");
    let view = shell({
      key: "repairs",
      title: "Repairs done",
      state: "not_started",
      statusText: "Not started",
      lines: [line("Repairs started", repairsStarted?.occurred_at), line("Repairs complete", repairsComplete?.occurred_at)].filter(
        (item): item is ClaimStepLine => Boolean(item),
      ),
      buttonLabel: audatexAuthorised ? "Record repairs" : null,
      buttonHref: audatexAuthorised ? href : null,
      detailsHref: href,
    });
    if (repairsComplete) {
      view = { ...view, state: "done", statusText: doneText(repairsComplete.occurred_at), buttonLabel: null, buttonHref: null };
    } else if (repairsStarted) {
      view = { ...view, state: "in_progress", statusText: "In progress", buttonLabel: "Record repairs", buttonHref: href };
    } else if (audatexAuthorised) {
      view = { ...view, state: "to_do", statusText: "To do" };
    }
    return applyNotNeeded("repairs", view);
  }

  function excessStep(): ClaimStepView {
    let view = shell({
      key: "excess",
      title: "Excess paid by the client",
      state: repairsComplete ? "to_do" : "not_started",
      statusText: repairsComplete ? "To do" : "Not started",
      detailsHref: path(input.claimId, "money"),
      forms: repairsComplete ? ["excess"] : [],
    });
    if (excess) {
      view = {
        ...view,
        state: "done",
        statusText: doneText(excess.at),
        detail: `${formatGbp(excess.pence)}${excess.method ? ` · ${excess.method}` : ""}`,
        forms: [],
      };
    }
    return applyNotNeeded("excess", view);
  }

  function returnStep(): ClaimStepView {
    let view = shell({
      key: "return_car",
      title: "Car returned to the client",
      state: excess ? "to_do" : "not_started",
      statusText: excess ? "To do" : "Not started",
      detail: excess ? null : "The excess has to be recorded as paid before the car can be returned.",
      buttonLabel: null,
      buttonHref: null,
      detailsHref: path(input.claimId, "repair"),
      forms: ["return"],
    });
    if (returned) {
      view = { ...view, state: "done", statusText: doneText(returned.occurred_at), detail: null, forms: [] };
    }
    return applyNotNeeded("return_car", view);
  }

  function invoiceStep(): ClaimStepView {
    const authorisedPence = audatexAuthorised ? input.audatex?.authorisedPence ?? null : null;
    const invoice = faultInvoicePence(authorisedPence, excess?.pence ?? null);
    const ready = invoice != null && Boolean(excess) && Boolean(audatexAuthorised);
    const lines = [
      moneyLine("Authorised", authorisedPence),
      excess ? moneyLine("Excess", excess.pence) : null,
      invoice != null ? { label: "Invoice", date: formatGbp(invoice) } : null,
    ].filter((item): item is ClaimStepLine => Boolean(item));
    let view = shell({
      key: "fault_invoice",
      title: "Invoice the client's own insurer",
      state: ready ? "to_do" : "not_started",
      statusText: ready ? "To do" : "Not started",
      detail: "The invoice is the authorised amount minus the client's excess.",
      lines,
      detailsHref: path(input.claimId, "money"),
      forms: ready && !invoiceSent ? ["invoice"] : [],
    });
    if (invoicePaid) {
      view = { ...view, state: "done", statusText: doneText(invoicePaid.occurred_at), forms: [] };
    } else if (invoiceSent) {
      view = {
        ...view,
        state: "waiting",
        statusText: "Waiting on the client's own insurer",
        forms: ["invoice_paid"],
      };
    }
    return applyNotNeeded("fault_invoice", view);
  }
}

export function currentClaimStep(steps: ClaimStepView[]): ClaimStepView | null {
  return steps.find((step) => step.state !== "done" && step.state !== "not_needed") || null;
}

/** The open step supplies the next action. A typed note is kept beside it and does not replace it. */
/**
 * Wording the new-claim form used to store as a next action. It was step guidance, not a staff note,
 * so it is never shown as a note. The step itself says what to do next.
 */
export const INTAKE_STEP_GUIDANCE = [
  "Pre-hire checks and choose a vehicle",
  "Arrange or confirm recovery and replacement transport",
  "Review new file",
];

export function resolveDisplayedNextAction(input: {
  storedAction: string | null | undefined;
  storedDue: string | null | undefined;
  steps: ClaimStepView[];
}): DisplayedNextAction {
  void input.storedDue;
  const step = currentClaimStep(input.steps);
  const stored = String(input.storedAction || "").trim();
  const note = INTAKE_STEP_GUIDANCE.includes(stored) ? "" : stored;
  if (!step) {
    return { action: "No open step", dueAt: null, fromStaff: false, note: note || null };
  }
  return {
    action: step.buttonLabel || step.title,
    dueAt: step.dueAt,
    fromStaff: false,
    note: note || null,
  };
}

export function isClaimStepKey(value: string): value is ClaimStepKey {
  return (CLAIM_STEP_KEYS as readonly string[]).includes(value);
}
