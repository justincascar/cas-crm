import Link from "next/link";
import { SubmitKeyInput } from "@/components/SubmitKeyInput";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";
const primary = "rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50";

/** R66: what the step 7–9 cards need from the file. */
export type TotalLossStepData = {
  approved8a: boolean;
  approved8b: boolean;
  clientEmail: string;
  insurer: { to: string; cc: string; name: string };
  reportOnFile: boolean;
  preview8a: string;
  preview8b: string;
  insurerEmailForReport: string;
};

function Preview({ text, label }: { text: string; label: string }) {
  if (!text) return null;
  return (
    <details className="text-sm" data-step-preview>
      <summary className="cursor-pointer text-teal-dark underline">{label}</summary>
      <pre className="mt-2 whitespace-pre-wrap break-words rounded-md border border-line bg-white p-3 font-sans">{text}</pre>
    </details>
  );
}

/** Step 7, total loss: Draft 8a to the client with a signing link, or signed on screen or on paper. */
export function TotalLossValuationForm({ claimId, data }: { claimId: string; data: TotalLossStepData }) {
  return (
    <div className="mt-3 space-y-2" data-tl-valuation>
      {!data.approved8a ? <p className="text-sm font-semibold text-overdue">Needs Justin&apos;s approval: Draft 8a is waiting in Settings → Draft documents.</p> : null}
      <Preview text={data.preview8a} label="Preview the valuation letter (Draft 8a)" />
      <form method="post" action={`/claims/${claimId}/steps/total-loss`} className="space-y-2 rounded-md border border-line bg-white p-3 text-sm">
        <input type="hidden" name="intent" value="send_client" />
        <label className="block max-w-md">
          Client&apos;s email
          <input name="to" type="email" defaultValue={data.clientEmail} className={field} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="attachReport" value="yes" defaultChecked={data.reportOnFile} disabled={!data.reportOnFile} /> Attach the engineer&apos;s report
          {data.reportOnFile ? "" : " (none on the file)"}
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={primary} disabled={!data.approved8a} data-send-valuation-client>
            Send valuation to client
          </button>
          <Link href={`/claims/${claimId}/sign-form/draft_tl_client`} className="text-teal-dark underline">
            Or the client signs on screen or on paper
          </Link>
        </div>
        <p className="text-xs text-slate">The client ticks A (accept, release), B (accept, keep the vehicle) or C (dispute) and answers the finance question. Email is simulated until the mailbox is connected.</p>
      </form>
    </div>
  );
}

/** Step 7: the handler resolves the client's dispute. */
export function TotalLossDisputeForm({ claimId }: { claimId: string }) {
  return (
    <form method="post" action={`/claims/${claimId}/steps/total-loss`} className="mt-3 space-y-2 rounded-md border border-warn bg-[#fff6e8] p-3 text-sm" data-tl-dispute>
      <input type="hidden" name="intent" value="resolve_dispute" />
      <label className="block">
        How was the dispute resolved?
        <textarea name="note" rows={2} required minLength={5} className={field} placeholder="for example: engineer revised the value after the client's adverts; new valuation sent" />
      </label>
      <button type="submit" className={primary}>
        Mark the dispute resolved
      </button>
    </form>
  );
}

/** Step 8, total loss: Draft 8b to the insurer with the report and the client's signed acceptance. */
export function TotalLossSendInsurerForm({ claimId, data }: { claimId: string; data: TotalLossStepData }) {
  return (
    <div className="mt-3 space-y-2" data-tl-send-insurer>
      {!data.approved8b ? <p className="text-sm font-semibold text-overdue">Needs Justin&apos;s approval: Draft 8b is waiting in Settings → Draft documents.</p> : null}
      <Preview text={data.preview8b} label="Preview the covering letter (Draft 8b)" />
      <form method="post" action={`/claims/${claimId}/steps/total-loss`} className="grid gap-2 rounded-md border border-line bg-white p-3 text-sm sm:grid-cols-2">
        <input type="hidden" name="intent" value="send_insurer" />
        <label>
          To ({data.insurer.name})
          <input name="to" type="email" defaultValue={data.insurer.to} className={field} />
        </label>
        <label>
          Copy to
          <input name="cc" type="email" defaultValue={data.insurer.cc} className={field} />
        </label>
        <div className="sm:col-span-2">
          <button type="submit" className={primary} disabled={!data.approved8b} data-send-valuation-insurer>
            Send valuation to the insurer
          </button>
          <p className="mt-1 text-xs text-slate">The report and the client&apos;s signed acceptance are attached. Sending starts the payment chase.</p>
        </div>
      </form>
    </div>
  );
}

/** Step 9, total loss: the payment, the salvage collection date and the actual proceeds, on the card. */
export function TotalLossStepNineForm({ claimId, today }: { claimId: string; today: string }) {
  return (
    <form method="post" action={`/claims/${claimId}/steps/total-loss`} className="mt-3 grid gap-2 rounded-md border border-line bg-white p-3 text-sm sm:grid-cols-3" data-tl-step9>
      <input type="hidden" name="intent" value="step9" />
      <SubmitKeyInput />
      <label>
        Payment received (£)
        <input name="payment" inputMode="decimal" className={field} placeholder="Leave blank if none yet" />
      </label>
      <label>
        Salvage collected on
        <input name="salvageCollectedOn" type="date" max={today} className={field} />
      </label>
      <label>
        Actual salvage proceeds (£)
        <input name="proceeds" inputMode="decimal" className={field} placeholder="If any" />
      </label>
      <div className="sm:col-span-3">
        <button type="submit" className={primary}>
          Save
        </button>
        <p className="mt-1 text-xs text-slate">A payment that does not settle the vehicle damage is flagged. The hire end is proposed 7 days after the qualifying payment, for a handler to confirm.</p>
      </div>
    </form>
  );
}

/** Step 7, repairable: the report and estimate to the insurer in one click, the report attached. */
export function RepairReportSendForm({ claimId, data }: { claimId: string; data: TotalLossStepData }) {
  return (
    <form method="post" action={`/claims/${claimId}/steps/total-loss`} className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-line bg-white p-3 text-sm" data-repair-report-send>
      <input type="hidden" name="intent" value="send_report" />
      <label className="min-w-64 flex-1">
        Insurer&apos;s email
        <input name="to" type="email" defaultValue={data.insurerEmailForReport} className={field} />
      </label>
      <button type="submit" className={primary} disabled={!data.reportOnFile}>
        Send report and estimate to the insurer
      </button>
      {!data.reportOnFile ? <p className="w-full text-xs text-overdue">No engineer&apos;s report on the file yet. Upload it at step 6.</p> : null}
      <p className="w-full text-xs text-slate">Simulated until the mailbox is connected; a simulated send is not recorded as sent, so mark it below if it went another way.</p>
    </form>
  );
}
