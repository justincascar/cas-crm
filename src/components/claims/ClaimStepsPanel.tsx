import Link from "next/link";
import { SubmitKeyInput } from "@/components/SubmitKeyInput";
import { londonTodayIso } from "@/lib/dates";
import type { ClaimStepForm, ClaimStepView } from "@/lib/domain/claim-steps";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

function stateClass(state: ClaimStepView["state"]): string {
  if (state === "done") return "text-ok";
  if (state === "waiting" || state === "in_progress") return "text-navy";
  if (state === "not_needed" || state === "not_decided") return "text-slate";
  return "text-ink";
}

export function ClaimStepsPanel({
  claimId,
  steps,
  error,
  saved,
}: {
  claimId: string;
  steps: ClaimStepView[];
  fault: boolean;
  error?: string;
  saved?: string;
}) {
  const today = londonTodayIso();
  return (
    <section aria-label="Claim steps" className="space-y-3" data-claim-steps>
      <h2 className="font-serif text-xl text-navy-deep">Steps</h2>
      {error ? <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p> : null}
      {saved ? <p className="rounded-md border border-ok/40 bg-[#eef6ef] px-4 py-3 text-sm">Saved on the file history.</p> : null}
      <ol className="space-y-3">
        {steps.map((step, index) => (
          <li key={step.key} id={`step-${step.key}`} className="rounded-xl border border-line bg-card px-4 py-3" data-step={step.key} data-state={step.state}>
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
            {step.forms.map((form) => (
              <StepForm key={form} claimId={claimId} form={form} today={today} />
            ))}
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

function StepForm({ claimId, form, today }: { claimId: string; form: ClaimStepForm; today: string }) {
  if (form === "report") return <ReportForm claimId={claimId} today={today} />;
  if (form === "route") return <RouteForm claimId={claimId} today={today} />;
  if (form === "engineer_instructed") return <DatedClick claimId={claimId} intent="engineer_instructed" label="Engineer instructed" today={today} />;
  if (form === "report_sent") return <DatedClick claimId={claimId} intent="report_sent" label="Sent to the insurer" today={today} />;
  if (form === "audatex_sent") return <AudatexForm claimId={claimId} intent="audatex_sent" today={today} />;
  if (form === "audatex_received") return <ReceivedForm claimId={claimId} today={today} />;
  if (form === "audatex_auth") return <AudatexForm claimId={claimId} intent="audatex_auth" />;
  if (form === "own_insurer") return <OwnInsurerForm claimId={claimId} />;
  if (form === "excess") return <ExcessForm claimId={claimId} />;
  if (form === "return") return <ReturnForm claimId={claimId} />;
  if (form === "invoice") return <InvoiceForm claimId={claimId} intent="invoice" label="Record invoice sent" />;
  return <InvoiceForm claimId={claimId} intent="invoice_paid" label="Record invoice paid" />;
}

/** One click with a date. The date starts as today and can be changed. */
function DatedClick({ claimId, intent, label, today }: { claimId: string; intent: string; label: string; today: string }) {
  return (
    <form action={`/claims/${claimId}/steps/save`} method="post" className="mt-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="returnTo" value={`/claims/${claimId}`} />
      <input type="hidden" name="intent" value={intent} />
      <SubmitKeyInput />
      <label className="text-sm">
        Date
        <input name="occurredOn" type="date" required max={today} defaultValue={today} className={field} />
      </label>
      <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
        {label}
      </button>
    </form>
  );
}

function ReportForm({ claimId, today }: { claimId: string; today: string }) {
  return (
    <form action={`/claims/${claimId}/steps/report`} method="post" encType="multipart/form-data" className="mt-3 grid gap-2">
      <input type="hidden" name="returnTo" value={`/claims/${claimId}`} />
      <SubmitKeyInput />
      <label className="text-sm">
        Date report received
        <input name="occurredOn" type="date" required max={today} defaultValue={today} className={field} />
      </label>
      <label className="text-sm">
        Upload the report (optional)
        <input name="document" type="file" className={field} />
      </label>
      <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
        Record report received
      </button>
    </form>
  );
}

function RouteForm({ claimId, today }: { claimId: string; today: string }) {
  return (
    <form action={`/claims/${claimId}/steps/save`} method="post" className="mt-3 grid gap-2">
      <input type="hidden" name="returnTo" value={`/claims/${claimId}`} />
      <input type="hidden" name="intent" value="route" />
      <SubmitKeyInput />
      <label className="text-sm">
        Engineer, Audatex estimate, or both
        <select name="route" required className={field} defaultValue="">
          <option value="" disabled>
            Choose
          </option>
          <option value="engineer">Engineer</option>
          <option value="audatex">Audatex estimate</option>
          <option value="both">Both</option>
        </select>
      </label>
      <label className="text-sm">
        Date
        <input name="occurredOn" type="date" required max={today} defaultValue={today} className={field} />
      </label>
      <p className="text-sm text-slate">There is no link to Audatex. The figures are typed on this file.</p>
      <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
        Save choice
      </button>
    </form>
  );
}

function AudatexForm({ claimId, intent, today }: { claimId: string; intent: "audatex_sent" | "audatex_auth"; today?: string }) {
  const authorising = intent === "audatex_auth";
  if (!authorising) {
    return (
      <form action={`/claims/${claimId}/steps/save`} method="post" className="mt-3 grid gap-2">
        <input type="hidden" name="returnTo" value={`/claims/${claimId}`} />
        <input type="hidden" name="intent" value={intent} />
        <SubmitKeyInput />
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Date
            <input name="occurredOn" type="date" required max={today} defaultValue={today} className={field} />
          </label>
          <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
            Audatex estimate sent
          </button>
        </div>
        <details>
          <summary className="cursor-pointer text-sm text-slate">Add the reference and figures (optional)</summary>
          <div className="mt-2 grid gap-2">
            <label className="text-sm">
              Audatex reference
              <input name="reference" className={field} />
            </label>
            <label className="text-sm">
              Estimate total (£)
              <input name="estimate" inputMode="decimal" className={field} />
            </label>
            <label className="text-sm">
              Labour (£), if given
              <input name="labour" inputMode="decimal" className={field} />
            </label>
            <label className="text-sm">
              Parts (£), if given
              <input name="parts" inputMode="decimal" className={field} />
            </label>
            <label className="text-sm">
              Paint (£), if given
              <input name="paint" inputMode="decimal" className={field} />
            </label>
          </div>
        </details>
      </form>
    );
  }
  return (
    <form action={`/claims/${claimId}/steps/save`} method="post" encType="multipart/form-data" className="mt-3 grid gap-2">
      <input type="hidden" name="returnTo" value={`/claims/${claimId}`} />
      <input type="hidden" name="intent" value={intent} />
      <SubmitKeyInput />
      <label className="text-sm">
        Date authorised
        <input name="occurredOn" type="date" required className={field} />
      </label>
      <label className="text-sm">
        Audatex reference
        <input name="reference" required className={field} />
      </label>
      <label className="text-sm">
        Estimate total (£)
        <input name="estimate" inputMode="decimal" required className={field} />
      </label>
      <label className="text-sm">
        Labour (£), if given
        <input name="labour" inputMode="decimal" className={field} />
      </label>
      <label className="text-sm">
        Parts (£), if given
        <input name="parts" inputMode="decimal" className={field} />
      </label>
      <label className="text-sm">
        Paint (£), if given
        <input name="paint" inputMode="decimal" className={field} />
      </label>
      <label className="text-sm">
            Authorised total (£)
            <input name="authorised" inputMode="decimal" required className={field} />
          </label>
          <Reduction label="Hourly rate reduction" amount="hourly" note="hourlyNote" />
          <Reduction label="Repair time reduction" amount="times" note="timesNote" />
          <Reduction label="Parts reduction" amount="partsReduction" note="partsNote" />
          <Reduction label="Other reduction" amount="other" note="otherNote" />
          <label className="text-sm">
            Authorisation document
            <input name="document" type="file" className={field} />
          </label>
          <p className="text-sm text-slate">Saving these figures does not change claimed, agreed or received. Use the existing agreed-figure screen if this amount should be the agreed figure.</p>
      <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
        Record authorisation
      </button>
    </form>
  );
}

function Reduction({ label, amount, note }: { label: string; amount: string; note: string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-sm">
        {label} (£)
        <input name={amount} inputMode="decimal" className={field} />
      </label>
      <label className="text-sm">
        Note
        <input name={note} className={field} />
      </label>
    </div>
  );
}

function ReceivedForm({ claimId, today }: { claimId: string; today: string }) {
  return (
    <form action={`/claims/${claimId}/steps/save`} method="post" className="mt-3 grid gap-2">
      <input type="hidden" name="returnTo" value={`/claims/${claimId}`} />
      <input type="hidden" name="intent" value="audatex_received" />
      <SubmitKeyInput />
      <label className="text-sm">
        Date estimate received
        <input name="occurredOn" type="date" required max={today} defaultValue={today} className={field} />
      </label>
      <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
        Record estimate received
      </button>
    </form>
  );
}

function OwnInsurerForm({ claimId }: { claimId: string }) {
  return (
    <form action={`/claims/${claimId}/steps/save`} method="post" className="mt-3 grid gap-2">
      <input type="hidden" name="returnTo" value={`/claims/${claimId}`} />
      <input type="hidden" name="intent" value="own_insurer" />
      <SubmitKeyInput />
      <label className="text-sm">
        Date notified
        <input name="occurredOn" type="date" required className={field} />
      </label>
      <label className="text-sm">
        Their claim number
        <input name="claimNumber" required className={field} />
      </label>
      <label className="text-sm">
        Note
        <input name="note" className={field} />
      </label>
      <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
        Record notification
      </button>
    </form>
  );
}

function ExcessForm({ claimId }: { claimId: string }) {
  return (
    <form action={`/claims/${claimId}/steps/save`} method="post" className="mt-3 grid gap-2">
      <input type="hidden" name="returnTo" value={`/claims/${claimId}`} />
      <input type="hidden" name="intent" value="excess" />
      <SubmitKeyInput />
      <label className="text-sm">
        Amount paid (£)
        <input name="amount" inputMode="decimal" required className={field} />
      </label>
      <label className="text-sm">
        Date paid
        <input name="occurredOn" type="date" required className={field} />
      </label>
      <label className="text-sm">
        How it was paid
        <input name="method" required className={field} />
      </label>
      <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
        Record excess paid
      </button>
    </form>
  );
}

function ReturnForm({ claimId }: { claimId: string }) {
  return (
    <form action={`/claims/${claimId}/steps/save`} method="post" className="mt-3 grid gap-2">
      <input type="hidden" name="returnTo" value={`/claims/${claimId}`} />
      <input type="hidden" name="intent" value="return" />
      <SubmitKeyInput />
      <label className="text-sm">
        Date returned
        <input name="occurredOn" type="date" required className={field} />
      </label>
      <label className="text-sm">
        Reason, only if the excess is not yet paid
        <input name="reason" className={field} />
      </label>
      <p className="text-sm text-slate">Returning the car before the excess is paid needs the releaseWithoutExcess permission and a reason.</p>
      <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
        Record car returned
      </button>
    </form>
  );
}

function InvoiceForm({ claimId, intent, label }: { claimId: string; intent: string; label: string }) {
  return (
    <form action={`/claims/${claimId}/steps/save`} method="post" className="mt-3 grid gap-2">
      <input type="hidden" name="returnTo" value={`/claims/${claimId}`} />
      <input type="hidden" name="intent" value={intent} />
      <SubmitKeyInput />
      <label className="text-sm">
        Date
        <input name="occurredOn" type="date" required className={field} />
      </label>
      <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
        {label}
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
