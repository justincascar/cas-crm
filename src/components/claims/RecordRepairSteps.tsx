import { eventLabel } from "@/lib/domain/events";
import { SIMULATED_REPORT_NOT_RECORDED } from "@/lib/domain/repair-progress";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

const INSPECTION_STEPS = [
  "engineer_inspection_booked",
  "engineer_inspection_attended",
  "engineer_report_sent_to_insurer",
] as const;

const WORKSHOP_STEPS = [
  "vehicle_received_for_repair",
  "parts_ordered",
  "parts_delayed",
  "repairs_started",
  "repairs_complete",
] as const;

export function RecordRepairSteps({
  claimId,
  mode,
  returnTo,
  error,
  saved,
  showSimulatedReport,
}: {
  claimId: string;
  mode: "inspection" | "workshop";
  returnTo: string;
  error?: string;
  saved?: string;
  showSimulatedReport?: boolean;
}) {
  const steps = mode === "inspection" ? INSPECTION_STEPS : WORKSHOP_STEPS;
  return (
    <section className="space-y-4 rounded-xl border border-line bg-card p-5">
      <div>
        <h2 className="font-serif text-xl text-navy-deep">Record step</h2>
        <p className="mt-1 text-sm text-slate">
          Each step keeps the date it happened, who recorded it, and a note. Once saved, it is not edited. A correction is a
          new entry.
        </p>
      </div>
      {showSimulatedReport ? (
        <p className="rounded-md border border-line bg-paper px-4 py-3 text-sm">
          If the engineer&apos;s report is emailed from this CRM while sending is simulated, that send is not recorded as
          sent. {SIMULATED_REPORT_NOT_RECORDED}. If it was sent outside the CRM, record it here.
        </p>
      ) : null}
      {error ? <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p> : null}
      {saved ? <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm text-ok">Step saved.</p> : null}
      <div className="grid gap-4">
        {steps.map((step) => (
          <form key={step} method="post" action={`/claims/${claimId}/repair/step`} className="space-y-2 rounded-lg border border-line p-4">
            <h3 className="text-sm font-semibold text-navy-deep">{eventLabel(step)}</h3>
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="intent" value="step" />
            <input type="hidden" name="step" value={step} />
            <label className="block text-sm">
              Date it happened
              <input name="occurredOn" type="date" required className={field} />
            </label>
            {step === "engineer_report_sent_to_insurer" ? (
              <label className="block text-sm">
                Sent to
                <input name="recipient" required className={field} placeholder="Insurer name" />
              </label>
            ) : null}
            {step === "parts_ordered" ? (
              <label className="block text-sm">
                Expected delivery (optional)
                <input name="expectedOn" type="date" className={field} />
              </label>
            ) : null}
            {step === "parts_delayed" ? (
              <label className="block text-sm">
                New expected date
                <input name="expectedOn" type="date" required className={field} />
              </label>
            ) : null}
            <label className="block text-sm">
              {step === "parts_delayed" ? "Reason" : "Note"}
              <input name="note" required className={field} />
            </label>
            <button type="submit" className="min-h-11 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
              Record step
            </button>
          </form>
        ))}
        <form method="post" action={`/claims/${claimId}/repair/step`} className="space-y-2 rounded-lg border border-line p-4">
          <h3 className="text-sm font-semibold text-navy-deep">Correction</h3>
          <p className="text-sm text-slate">A new entry. The original step is not changed.</p>
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="intent" value="correction" />
          <label className="block text-sm">
            Step
            <select name="step" className={field} required defaultValue={steps[0]}>
              {steps.map((step) => (
                <option key={step} value={step}>
                  {eventLabel(step)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Date of this correction
            <input name="occurredOn" type="date" required className={field} />
          </label>
          <label className="block text-sm">
            Reason
            <input name="reason" required className={field} />
          </label>
          <button type="submit" className="min-h-11 rounded-md bg-teal px-3 py-2 text-sm font-semibold text-white">
            Record correction
          </button>
        </form>
      </div>
    </section>
  );
}
