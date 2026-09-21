"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  actionCancelChase,
  actionClearChaseOutcome,
  actionClearChaseOverride,
  actionLogChaseOutcome,
  actionMarkChaseSent,
  actionPauseChase,
  actionPrepareChase,
  actionResumeChase,
  actionSaveChaseOverride,
} from "@/app/chase-actions";
import { CAS_CLAIMS_MAILBOX } from "@/lib/constants";
import { formatUkDate, formatUkDateTime } from "@/lib/dates";
import { buildMailtoHref } from "@/lib/email/mailto";
import { LIABILITY_DECISIONS, REPAIR_OUTCOMES, chaseStageShortLabel, chaseStageTextClass } from "@/lib/domain/chase";
import type { ChaseView } from "@/lib/db/chase";
import type { EngineerChaseView } from "@/lib/db/engineer-chase";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export type HireAgreementHistoryRow = {
  id: string;
  sequence: number;
  start_on: string;
  planned_end_on: string;
  signed: number;
  signature_status: string;
};

type PreparedChase = {
  id: string;
  subject: string | null;
  to_address: string | null;
  body: string | null;
  created_at: string;
};

function intervalSourceLabel(chase: ChaseView) {
  if (chase.kind === "hire_agreement_renewal") {
    const max = chase.agreementMaxDays || 88;
    const approaching = chase.agreementApproachingDay || 70;
    if (chase.intervalSource === "claim_override") {
      return `Amber from day ${approaching}; red alert on day ${chase.intervalDays} of the current signed agreement on this file${chase.overrideReason ? ` — ${chase.overrideReason}` : ""}. Agreement limit ${max} days. Global red alert day is ${chase.globalIntervalDays}.`;
    }
    if (chase.intervalSource === "frozen") {
      return `Amber from day ${approaching}; red alert on day ${chase.intervalDays} (held from when this chase was paused or cancelled). Agreement limit ${max} days. Global red alert day is ${chase.globalIntervalDays}.`;
    }
    return `Amber from day ${approaching}; red alert on day ${chase.intervalDays} of the current signed agreement (global default). Agreement limit ${max} days.`;
  }
  if (chase.intervalSource === "claim_override") {
    return `${chase.intervalDays} calendar days on this file${chase.overrideReason ? ` — ${chase.overrideReason}` : ""}. Global default is ${chase.globalIntervalDays} days.`;
  }
  if (chase.intervalSource === "frozen") {
    return `${chase.intervalDays} calendar days (held from when this chase was paused or cancelled). Global default is ${chase.globalIntervalDays} days.`;
  }
  return `${chase.intervalDays} calendar days (global default).`;
}

function stateLabel(chase: ChaseView) {
  if (chase.kind === "hire_agreement_renewal") {
    if (chase.handlerState === "paused") return "Paused";
    if (chase.handlerState === "cancelled") return "Cancelled";
    if (chase.due) return chase.label || chase.dueLabel;
    if (!chase.clockAt) return "Agreement start date not recorded";
    if (!chase.active) return "Hire ended — no renewal alert";
    return "Tracking — approaching day not yet reached";
  }
  if (chase.outcomeOnFile) return "Outcome logged — chase not showing as due";
  if (chase.handlerState === "paused") return "Paused";
  if (chase.handlerState === "cancelled") return "Cancelled";
  if (chase.due) return "Chase due";
  return "Tracking — interval not yet reached";
}

export function ChasePanel({
  claimId,
  chase,
  prepared,
  agreements,
}: {
  claimId: string;
  chase: ChaseView;
  prepared: PreparedChase | null;
  agreements?: HireAgreementHistoryRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [mailto, setMailto] = useState<string | null>(() =>
    prepared?.to_address && prepared.body
      ? buildMailtoHref(prepared.to_address, prepared.subject || chase.title, prepared.body)
      : null,
  );
  const [preparedId, setPreparedId] = useState(prepared?.id || "");
  const [toAddress, setToAddress] = useState(prepared?.to_address || chase.contactEmail);

  async function run<T extends { error?: string }>(
    action: (form: FormData) => Promise<T>,
    extra?: Record<string, string>,
  ): Promise<T> {
    setBusy(true);
    setMessage(null);
    const form = new FormData();
    form.set("claimId", claimId);
    form.set("kind", chase.kind);
    if (extra) {
      for (const [key, value] of Object.entries(extra)) form.set(key, value);
    }
    const result = await action(form);
    setBusy(false);
    if (result.error) {
      setMessage(result.error);
      return result;
    }
    router.refresh();
    return result;
  }

  async function prepare() {
    const result = await run(actionPrepareChase);
    if (result.error) return;
    const prepared = result as {
      error?: string;
      mailto?: string;
      correspondenceId?: string;
      to?: string;
    };
    if (!prepared.mailto) return;
    setMailto(prepared.mailto);
    setPreparedId(String(prepared.correspondenceId || ""));
    setToAddress(String(prepared.to || chase.contactEmail));
    window.location.href = prepared.mailto;
  }

  async function markSent() {
    if (!preparedId) {
      setMessage("Prepare the chase email first, then mark it as sent after you have sent it.");
      return;
    }
    const result = await run(actionMarkChaseSent, { correspondenceId: preparedId });
    if (result.error) return;
    setMessage(`Marked as sent. The chase interval has restarted. Not auto-sent from ${CAS_CLAIMS_MAILBOX}.`);
    setMailto(null);
    setPreparedId("");
  }

  const tone =
    chase.severity === "amber"
      ? "border-warn bg-[#fff6e8]"
      : chase.severity === "red" || chase.severity === "red_overdue" || chase.due
        ? "border-overdue bg-[#f8ecec]"
        : chase.handlerState === "paused"
          ? "border-warn/40 bg-[#fff6e8]"
          : chase.handlerState === "cancelled"
            ? "border-line bg-card"
            : chase.outcomeOnFile
              ? "border-ok/40 bg-[#eef6ef]"
              : "border-teal bg-[#e8f4f2]";

  const contactLine =
    chase.kind === "hire_agreement_renewal"
      ? "Counted from the current signed hire agreement start date, not from the fleet booking dates."
      : chase.kind === "engineer_report"
      ? `Engineer: ${chase.contactName}${chase.contactEmail ? ` · ${chase.contactEmail}` : ""}`
      : `Insurer contact: ${chase.contactName}${chase.contactEmail ? ` · ${chase.contactEmail}` : ""}`;

  return (
    <section className={`rounded-xl border-2 p-5 ${tone}`}>
      <h2 className="font-serif text-xl text-navy-deep">{chase.title}</h2>
      <p className="mt-1 text-sm">
        <strong>Current state: {stateLabel(chase)}.</strong> Recalculated from this file each time you open it. Nothing is
        sent automatically from {CAS_CLAIMS_MAILBOX}.
      </p>
      <dl className="mt-3 grid gap-1 text-sm">
        <div>{contactLine}</div>
        {chase.clockAt ? (
          <div>
            <span className="text-slate">{chase.kind === "hire_agreement_renewal" ? "Current agreement started: " : "Clock started: "}</span>
            {formatUkDateTime(chase.clockAt)}
            {chase.kind === "hire_agreement_renewal" && chase.agreementDay != null
              ? ` · day ${chase.agreementDay} of this agreement`
              : chase.daysOutstanding !== null
                ? ` · ${chase.daysOutstanding} day${chase.daysOutstanding === 1 ? "" : "s"} outstanding`
                : ""}
          </div>
        ) : null}
        {chase.kind === "hire_agreement_renewal" && chase.due ? (
          <div>
            <span className="text-slate">Stage: </span>
            <span className={chaseStageTextClass(chase.severity)}>{chaseStageShortLabel(chase.severity)}</span>
          </div>
        ) : null}
        {chase.dueAt ? (
          <div>
            <span className="text-slate">Chase due from: </span>
            {formatUkDate(chase.dueAt)}
          </div>
        ) : null}
        <div>
          <span className="text-slate">Interval: </span>
          {intervalSourceLabel(chase)}
        </div>
        <div>
          <span className="text-slate">Why: </span>
          {chase.reason}
        </div>
      </dl>

      {chase.kind === "hire_agreement_renewal" && agreements && agreements.length > 0 ? (
        <div className="mt-3 rounded-md border border-line bg-white px-4 py-3 text-sm">
          <p className="font-semibold text-navy-deep">Agreement periods on this hire</p>
          <p className="mt-1 text-xs text-slate">
            Continuous history from the first agreement. A renewal adds a new period; earlier periods stay on the file.
          </p>
          <ul className="mt-2 space-y-1">
            {agreements.map((row) => {
              const start = String(row.start_on || "").trim();
              return (
                <li key={row.id}>
                  Period {row.sequence}: {start ? formatUkDate(start) : "Start date not recorded"}
                  {row.planned_end_on ? ` to ${formatUkDate(String(row.planned_end_on))}` : ""}
                  {" · "}
                  {Number(row.signed) === 1 ? "Signed" : "Unsigned"}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {chase.due ? (
        <p
          className={`mt-3 rounded-md border bg-white px-4 py-3 text-sm font-semibold ${
            chase.severity === "amber" ? "border-warn/40 text-warn" : "border-overdue/40 text-overdue"
          }`}
        >
          {chase.label || chase.dueLabel}
        </p>
      ) : null}

      {chase.contactMissing && chase.due ? (
        <p className="mt-3 rounded-md border border-warn/40 bg-white px-4 py-3 text-sm">{chase.contactMissingMessage}</p>
      ) : null}

      {chase.handlerState !== "cancelled" && !chase.outcomeOnFile ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {chase.due && !chase.contactMissing && chase.kind !== "hire_agreement_renewal" ? (
            <>
              <button
                type="button"
                className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white"
                disabled={busy}
                onClick={() => void prepare()}
              >
                Prepare chase email
              </button>
              {mailto ? (
                <a className="rounded-md border border-teal bg-white px-4 py-2 text-sm font-semibold text-teal-dark" href={mailto}>
                  Open pre-filled email
                </a>
              ) : null}
            </>
          ) : null}
          {chase.handlerState === "paused" ? (
            <button
              type="button"
              className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white"
              disabled={busy}
              onClick={() => void run(actionResumeChase)}
            >
              Resume chase
            </button>
          ) : (
            <button
              type="button"
              className="rounded-md border border-line bg-white px-4 py-2 text-sm"
              disabled={busy}
              onClick={() => void run(actionPauseChase)}
            >
              Pause chase
            </button>
          )}
          <button
            type="button"
            className="rounded-md border border-overdue bg-white px-4 py-2 text-sm text-overdue"
            disabled={busy}
            onClick={() => void run(actionCancelChase)}
          >
            Cancel chase
          </button>
        </div>
      ) : null}

      {mailto && chase.due ? (
        <p className="mt-3 rounded-md border border-ok/40 bg-white px-4 py-3 text-sm">
          A pre-filled email to <strong>{toAddress}</strong> is ready in your email client. After you click send there,
          mark it as sent on this file. The CRM has not sent it from {CAS_CLAIMS_MAILBOX}.
        </p>
      ) : prepared && preparedId && chase.due ? (
        <p className="mt-3 rounded-md border border-warn/40 bg-white px-4 py-3 text-sm">
          A chase email was prepared {formatUkDateTime(prepared.created_at)} for {prepared.to_address}. Open it from your
          client if you still need to send it, then mark it as sent.
        </p>
      ) : null}

      {preparedId && chase.due && !chase.contactMissing ? (
        <div className="mt-3">
          <button
            type="button"
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white"
            disabled={busy}
            onClick={() => void markSent()}
          >
            Mark chase as sent
          </button>
        </div>
      ) : null}

      {!chase.outcomeOnFile ? (
        <form
          className="mt-4 grid gap-2 rounded-md border border-line bg-white p-3 sm:grid-cols-[1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void run(actionLogChaseOutcome, {
              occurredAt: String(form.get("occurredAt") || ""),
              liabilityDecision: String(form.get("liabilityDecision") || ""),
              repairOutcome: String(form.get("repairOutcome") || ""),
            });
          }}
        >
          {chase.kind === "liability_response" ? (
            <label className="text-sm">
              Insurer decision
              <select name="liabilityDecision" className={field} required defaultValue="">
                <option value="" disabled>
                  Choose a decision
                </option>
                {LIABILITY_DECISIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {chase.kind === "repair_authorisation" ? (
            <label className="text-sm">
              What was received
              <select name="repairOutcome" className={field} required defaultValue="">
                <option value="" disabled>
                  Choose authorisation or payment
                </option>
                {REPAIR_OUTCOMES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="text-sm">
            {chase.kind === "engineer_report"
              ? "Date report received"
              : chase.kind === "liability_response"
                ? "Date decision received"
                : chase.kind === "hire_agreement_renewal"
                  ? "Date this renewal starts"
                  : "Date received"}
            <input name="occurredAt" type="date" className={field} />
          </label>
          <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white" disabled={busy}>
            {chase.kind === "engineer_report"
              ? "Log report received"
              : chase.kind === "liability_response"
                ? "Log liability decision"
                : chase.kind === "hire_agreement_renewal"
                  ? "Log agreement renewed"
                  : "Log authorisation or payment received"}
          </button>
        </form>
      ) : (
        <div className="mt-4">
          <button
            type="button"
            className="rounded-md border border-line bg-white px-4 py-2 text-sm"
            disabled={busy}
            onClick={() => void run(actionClearChaseOutcome)}
          >
            Logged in error
          </button>
        </div>
      )}
      {chase.kind === "hire_agreement_renewal" && chase.canClearHireRenewal && !chase.outcomeOnFile ? (
        <div className="mt-3">
          <button
            type="button"
            className="rounded-md border border-line bg-white px-4 py-2 text-sm"
            disabled={busy}
            onClick={() => void run(actionClearChaseOutcome)}
          >
            Last logged renewal was in error
          </button>
        </div>
      ) : null}

      {chase.handlerState !== "cancelled" ? (
        <form
          className="mt-4 grid gap-2 rounded-md border border-line bg-white p-3 md:grid-cols-[8rem_1fr_auto] md:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void run(actionSaveChaseOverride, {
              overrideDays: String(form.get("overrideDays") || ""),
              overrideReason: String(form.get("overrideReason") || ""),
            });
          }}
        >
          <label className="text-sm">
            {chase.kind === "hire_agreement_renewal" ? "This file's alert day" : "This file's interval (days)"}
            <input
              name="overrideDays"
              type="number"
              min={1}
              step={1}
              required
              className={field}
              defaultValue={chase.overrideDays || ""}
            />
          </label>
          <label className="text-sm">
            Why (for example {chase.kind === "hire_agreement_renewal" ? "“longer first agreement”" : "“agreed with insurer”"})
            <input
              name="overrideReason"
              type="text"
              required
              className={field}
              defaultValue={chase.overrideReason || ""}
              placeholder={chase.kind === "hire_agreement_renewal" ? "Agreed longer first period" : "Agreed with insurer"}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white" disabled={busy}>
              Save file interval
            </button>
            {chase.overrideDays ? (
              <button
                type="button"
                className="rounded-md border border-line bg-white px-4 py-2 text-sm"
                disabled={busy}
                onClick={() => void run(actionClearChaseOverride)}
              >
                Use global default
              </button>
            ) : null}
          </div>
        </form>
      ) : null}

      {message ? <p className="mt-3 text-sm">{message}</p> : null}
    </section>
  );
}

export function EngineerChasePanel({
  claimId,
  chase,
  prepared,
}: {
  claimId: string;
  chase: EngineerChaseView;
  prepared: PreparedChase | null;
}) {
  const view: ChaseView = {
    kind: "engineer_report",
    claimId,
    title: "Engineer report chase",
    dueLabel: chase.label || "Engineer report chase due",
    active: chase.active,
    due: chase.due,
    outcomeOnFile: chase.reportOnFile,
    handlerState: chase.handlerState,
    daysOutstanding: chase.daysOutstanding,
    clockAt: chase.clockAt,
    dueAt: chase.dueAt,
    reason: chase.reason,
    label: chase.label,
    contactName: chase.engineerName,
    contactEmail: chase.engineerEmail,
    contactMissing: !chase.engineerEmail,
    contactMissingMessage: chase.engineerEmail ? null : "This engineer has no email address. Add one under Settings → Engineers.",
    frozenIntervalDays: chase.frozenIntervalDays,
    globalIntervalDays: chase.frozenIntervalDays,
    overrideDays: null,
    overrideReason: null,
    intervalDays: chase.frozenIntervalDays,
    intervalSource: chase.handlerState === "tracking" ? "settings" : "frozen",
    severity: chase.due ? "red" : null,
  };
  return <ChasePanel claimId={claimId} chase={view} prepared={prepared} />;
}
