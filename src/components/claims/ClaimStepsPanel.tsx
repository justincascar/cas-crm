import Link from "next/link";
import { RuleHint } from "@/components/dashboard/RuleHint";
import { SubmitKeyInput } from "@/components/SubmitKeyInput";
import type { ClaimStepView } from "@/lib/domain/claim-steps";
import { FAULT_STEP_PROPOSAL } from "@/lib/domain/claim-steps";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

function stateClass(state: ClaimStepView["state"]): string {
  if (state === "done") return "text-ok";
  if (state === "waiting" || state === "in_progress") return "text-navy";
  if (state === "not_needed") return "text-slate";
  return "text-ink";
}

export function ClaimStepsPanel({
  claimId,
  steps,
  fault,
  error,
  saved,
}: {
  claimId: string;
  steps: ClaimStepView[];
  fault: boolean;
  error?: string;
  saved?: string;
}) {
  return (
    <section aria-label="Claim steps" className="space-y-3" data-claim-steps>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-xl text-navy-deep">Steps</h2>
        {fault ? <RuleHint text={FAULT_STEP_PROPOSAL.join(" ")} /> : null}
      </div>
      {error ? <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p> : null}
      {saved ? <p className="rounded-md border border-ok/40 bg-[#eef6ef] px-4 py-3 text-sm">Saved on the file history.</p> : null}
      <ol className="space-y-3">
        {steps.map((step, index) => (
          <li key={step.key} id={`step-${step.key}`} className="rounded-xl border border-line bg-card px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-navy-deep">
                {index + 1}. {step.title}
              </h3>
              <p className={`text-sm ${stateClass(step.state)}`}>{step.statusText}</p>
            </div>
            {step.detail ? <p className="mt-1 text-sm">{step.detail}</p> : null}
            {step.missingCount > 0 && step.missingHref ? (
              <p className="mt-1 text-sm">
                <Link href={step.missingHref} className="text-teal-dark underline">
                  {step.missingCount} {step.missingCount === 1 ? "detail" : "details"} missing
                </Link>
              </p>
            ) : null}
            {step.progressTotal ? (
              <p className="mt-1 text-sm text-slate">
                {step.progressDone} of {step.progressTotal}
              </p>
            ) : null}
            {step.lines.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm">
                {step.lines.map((item) => (
                  <li key={`${step.key}-${item.label}`}>
                    {item.label}: {item.date}
                  </li>
                ))}
              </ul>
            ) : null}
            {step.historyLines.length > 0 ? (
              <div className="mt-2">
                <p className="text-xs uppercase tracking-[0.12em] text-slate">Earlier repair history</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {step.historyLines.map((item) => (
                    <li key={`${step.key}-history-${item.label}`}>
                      {item.label}: {item.date}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {step.buttonHref && step.buttonLabel ? (
                <Link href={step.buttonHref} className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
                  {step.buttonLabel}
                </Link>
              ) : null}
              <Link href={step.detailsHref} className="text-sm text-teal-dark underline">
                details
              </Link>
            </div>
            {step.buttonForm === "report" ? <ReportForm claimId={claimId} /> : null}
            {step.buttonForm === "agree" ? <AgreeForm claimId={claimId} /> : null}
            {step.state !== "done" && step.state !== "not_needed" ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-slate">Not needed</summary>
                <NotNeededForm claimId={claimId} step={step.key} />
              </details>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ReportForm({ claimId }: { claimId: string }) {
  return (
    <form action={`/claims/${claimId}/steps/report`} method="post" encType="multipart/form-data" className="mt-3 grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-end">
      <input type="hidden" name="returnTo" value={`/claims/${claimId}`} />
      <SubmitKeyInput />
      <label className="text-sm">
        Date report received
        <input name="occurredOn" type="date" required className={field} />
      </label>
      <label className="text-sm">
        Upload the report
        <input name="document" type="file" className={field} />
      </label>
      <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
        Record report received
      </button>
    </form>
  );
}

function AgreeForm({ claimId }: { claimId: string }) {
  return (
    <form action={`/claims/${claimId}/steps/agree`} method="post" className="mt-3 grid gap-2">
      <input type="hidden" name="returnTo" value={`/claims/${claimId}`} />
      <SubmitKeyInput />
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm">
          Date agreed
          <input name="occurredOn" type="date" required className={field} />
        </label>
        <label className="text-sm">
          Note
          <input name="note" required className={field} />
        </label>
      </div>
      <RuleHint text="This records the date, who agreed it, and the note. It does not change the agreed figure." />
      <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
        Record agreement
      </button>
    </form>
  );
}

function NotNeededForm({ claimId, step }: { claimId: string; step: string }) {
  return (
    <form action={`/claims/${claimId}/steps/not-needed`} method="post" className="mt-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="returnTo" value={`/claims/${claimId}`} />
      <input type="hidden" name="step" value={step} />
      <SubmitKeyInput />
      <label className="text-sm">
        Not needed, with a reason
        <input name="reason" required className={field} />
      </label>
      <label className="text-sm">
        Date
        <input name="occurredOn" type="date" required className={field} />
      </label>
      <button type="submit" className="rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-navy">
        Mark not needed
      </button>
    </form>
  );
}
