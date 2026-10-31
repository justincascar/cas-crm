import Link from "next/link";
import { formatUkDateTime } from "@/lib/dates";
import type { DispatchGap, DispatchView } from "@/lib/db/engineer-dispatch";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export type InstructStepData = DispatchView & { gaps: DispatchGap[]; preview: { subject: string; body: string } | null };

/**
 * R65: step 5 does its job on the card. The engineer gets the instruction (PDF and photos attached, the handler copied
 * in) in one click; the Audatex estimator gets a task and an email. Missing items stop the send and say where to fix
 * them; no photos only warns.
 */
export function InstructStepCard({ claimId, data, wantsEngineer, wantsAudatex }: { claimId: string; data: InstructStepData; wantsEngineer: boolean; wantsAudatex: boolean }) {
  const action = `/claims/${claimId}/steps/instruct`;
  const blocking = data.gaps.filter((gap) => gap.blocking);
  const warnings = data.gaps.filter((gap) => !gap.blocking);
  const engineerName = data.engineers.find((engineer) => engineer.id === data.defaultEngineerId)?.name || "the engineer";
  const engineerPending = wantsEngineer && !data.instructed;
  const audatexPending = wantsAudatex && !data.audatexSent;
  return (
    <div className="mt-3 space-y-3" data-instruct-card>
      {data.instructed ? <p className="text-sm text-ok" data-instructed>{data.instructed.details || `Engineer instructed ${formatUkDateTime(data.instructed.at)}`}</p> : null}
      {data.audatexSent ? <p className="text-sm text-ok" data-audatex-requested>{data.audatexSent.details}</p> : null}
      {engineerPending || audatexPending ? (
        <form method="post" action={action} className="space-y-3 rounded-md border border-line bg-white p-3 text-sm">
          {engineerPending ? (
            <>
              <label className="block max-w-md">
                Engineer
                <select name="engineerId" defaultValue={data.defaultEngineerId} className={field}>
                  {data.engineers.map((engineer) => (
                    <option key={engineer.id} value={engineer.id}>
                      {engineer.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-slate">
                Copied to: {data.cc.length ? data.cc.join(", ") : "nobody (no handler email)"}. {data.photos} photo{data.photos === 1 ? "" : "s"} and the instruction as a PDF are attached.
              </p>
              {blocking.length ? (
                <div className="rounded-md border border-overdue/40 bg-[#f8ecec] px-3 py-2 text-overdue" data-instruct-missing>
                  <p className="font-semibold">Fix these before it is sent:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {blocking.map((gap) => (
                      <li key={gap.label}>
                        <Link href={gap.href} className="underline">
                          {gap.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {warnings.map((gap) => (
                <label key={gap.label} className="flex items-start gap-2 rounded-md border border-warn bg-[#fff6e8] px-3 py-2" data-instruct-warning>
                  <input type="checkbox" name="sendWithoutPhotos" value="yes" className="mt-1" />
                  <span>
                    {gap.label}{" "}
                    <Link href={gap.href} className="text-teal-dark underline">
                      Add photos
                    </Link>
                    . Tick to send without photos.
                  </span>
                </label>
              ))}
              {data.preview ? (
                <details data-instruct-preview>
                  <summary className="cursor-pointer text-teal-dark underline">Preview first (optional)</summary>
                  <p className="mt-2">
                    <span className="font-semibold">Subject:</span> {data.preview.subject}
                  </p>
                  <pre className="mt-2 whitespace-pre-wrap break-words font-sans">{data.preview.body}</pre>
                </details>
              ) : null}
            </>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {engineerPending ? (
              <button type="submit" name="intent" value="engineer" className="rounded-md bg-navy px-3 py-2 font-semibold text-white" data-send-instruction>
                Send instruction to {engineerName}
              </button>
            ) : null}
            {audatexPending ? (
              <button type="submit" name="intent" value="audatex" className={engineerPending ? "rounded-md border border-line bg-white px-3 py-2 font-semibold text-navy" : "rounded-md bg-navy px-3 py-2 font-semibold text-white"} data-send-audatex>
                Send to {data.estimator?.name || "the estimator"} for Audatex
              </button>
            ) : null}
            {engineerPending && audatexPending ? (
              <button type="submit" name="intent" value="both" className="rounded-md border border-line bg-white px-3 py-2 font-semibold text-navy" data-send-both>
                Send both
              </button>
            ) : null}
          </div>
          <p className="text-xs text-slate">Email is simulated until CAS&apos;s mailbox is connected. The email is filed in Communications and the history.</p>
        </form>
      ) : null}
    </div>
  );
}
