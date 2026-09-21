"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  actionCancelEngineerChase,
  actionClearEngineerReportReceived,
  actionLogEngineerReportReceived,
  actionMarkEngineerReportChaseSent,
  actionPauseEngineerChase,
  actionPrepareEngineerReportChase,
  actionResumeEngineerChase,
} from "@/app/engineer-chase-actions";
import { CAS_CLAIMS_MAILBOX } from "@/lib/constants";
import { formatUkDate, formatUkDateTime } from "@/lib/dates";
import { buildMailtoHref } from "@/lib/email/mailto";
import type { EngineerChaseView } from "@/lib/db/engineer-chase";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

type PreparedChase = {
  id: string;
  subject: string | null;
  to_address: string | null;
  body: string | null;
  created_at: string;
};

export function EngineerChasePanel({
  claimId,
  chase,
  prepared,
}: {
  claimId: string;
  chase: EngineerChaseView;
  prepared: PreparedChase | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [mailto, setMailto] = useState<string | null>(() =>
    prepared?.to_address && prepared.body
      ? buildMailtoHref(prepared.to_address, prepared.subject || "Engineer report chase", prepared.body)
      : null,
  );
  const [preparedId, setPreparedId] = useState(prepared?.id || "");
  const [toAddress, setToAddress] = useState(prepared?.to_address || chase.engineerEmail);

  async function run(action: (form: FormData) => Promise<{ error?: string }>, extra?: Record<string, string>) {
    setBusy(true);
    setMessage(null);
    const form = new FormData();
    form.set("claimId", claimId);
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
    const result = await run(actionPrepareEngineerReportChase);
    if (!result || result.error || !("mailto" in result) || !result.mailto) return;
    setMailto(result.mailto as string);
    setPreparedId(String(result.correspondenceId || ""));
    setToAddress(String(result.to || chase.engineerEmail));
    window.location.href = result.mailto as string;
  }

  async function markSent() {
    if (!preparedId) {
      setMessage("Prepare the chase email first, then mark it as sent after you have sent it.");
      return;
    }
    const result = await run(actionMarkEngineerReportChaseSent, { correspondenceId: preparedId });
    if (result.error) return;
    setMessage(`Marked as sent. The chase interval has restarted. Not auto-sent from ${CAS_CLAIMS_MAILBOX}.`);
    setMailto(null);
    setPreparedId("");
  }

  const tone = chase.due
    ? "border-overdue bg-[#f8ecec]"
    : chase.handlerState === "paused"
      ? "border-warn/40 bg-[#fff6e8]"
      : chase.handlerState === "cancelled"
        ? "border-line bg-card"
        : chase.reportOnFile
          ? "border-ok/40 bg-[#eef6ef]"
          : "border-teal bg-[#e8f4f2]";

  const stateLabel = chase.reportOnFile
    ? "Report received — chase not showing as due"
    : chase.handlerState === "paused"
      ? "Paused"
      : chase.handlerState === "cancelled"
        ? "Cancelled"
        : chase.due
          ? "Chase due"
          : "Tracking — interval not yet reached";

  return (
    <section className={`rounded-xl border-2 p-5 ${tone}`}>
      <h2 className="font-serif text-xl text-navy-deep">Engineer report chase</h2>
      <p className="mt-1 text-sm">
        <strong>Current state: {stateLabel}.</strong> Recalculated from this file each time you open it. Nothing is sent
        automatically from {CAS_CLAIMS_MAILBOX}.
      </p>
      <dl className="mt-3 grid gap-1 text-sm">
        <div>
          <span className="text-slate">Engineer: </span>
          {chase.engineerName}
          {chase.engineerEmail ? ` · ${chase.engineerEmail}` : ""}
        </div>
        {chase.clockAt ? (
          <div>
            <span className="text-slate">Clock started: </span>
            {formatUkDateTime(chase.clockAt)}
            {chase.daysOutstanding !== null ? ` · ${chase.daysOutstanding} day${chase.daysOutstanding === 1 ? "" : "s"} outstanding` : ""}
          </div>
        ) : null}
        {chase.dueAt ? (
          <div>
            <span className="text-slate">Chase due from: </span>
            {formatUkDate(chase.dueAt)}
          </div>
        ) : null}
        <div>
          <span className="text-slate">Why: </span>
          {chase.reason}
        </div>
      </dl>

      {chase.due ? (
        <p className="mt-3 rounded-md border border-overdue/40 bg-white px-4 py-3 text-sm font-semibold text-overdue">
          Engineer report chase due
        </p>
      ) : null}

      {chase.handlerState !== "cancelled" && !chase.reportOnFile ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {chase.due ? (
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
              onClick={() => void run(actionResumeEngineerChase)}
            >
              Resume chase
            </button>
          ) : (
            <button
              type="button"
              className="rounded-md border border-line bg-white px-4 py-2 text-sm"
              disabled={busy}
              onClick={() => void run(actionPauseEngineerChase)}
            >
              Pause chase
            </button>
          )}
          <button
            type="button"
            className="rounded-md border border-overdue bg-white px-4 py-2 text-sm text-overdue"
            disabled={busy}
            onClick={() => void run(actionCancelEngineerChase)}
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

      {preparedId && chase.due ? (
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

      {!chase.reportOnFile ? (
        <form
          className="mt-4 grid gap-2 rounded-md border border-line bg-white p-3 sm:grid-cols-[1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void run(actionLogEngineerReportReceived, {
              occurredAt: String(form.get("occurredAt") || ""),
            });
          }}
        >
          <label className="text-sm">
            Date report received
            <input name="occurredAt" type="date" className={field} />
          </label>
          <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white" disabled={busy}>
            Log report received
          </button>
        </form>
      ) : (
        <div className="mt-4">
          <button
            type="button"
            className="rounded-md border border-line bg-white px-4 py-2 text-sm"
            disabled={busy}
            onClick={() => void run(actionClearEngineerReportReceived)}
          >
            Report was logged in error
          </button>
        </div>
      )}

      {message ? <p className="mt-3 text-sm">{message}</p> : null}
    </section>
  );
}
