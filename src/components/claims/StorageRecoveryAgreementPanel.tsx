import Link from "next/link";
import { formatUkDate } from "@/lib/dates";
import { storageRecoverySignedLine, type StorageRecoveryState } from "@/lib/db/storage-recovery-signing";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

/**
 * The client signs the Storage & Recovery Agreement before recovery or storage is claimed. It is the supplied Hire Pack
 * wording. A client whose signed hire agreement already included the Storage & Recovery page has nothing more to sign.
 */
export function StorageRecoveryAgreementPanel({
  claimId,
  state,
  clientName,
  hasHireCar,
  canOverride,
}: {
  claimId: string;
  state: StorageRecoveryState;
  clientName: string;
  hasHireCar: boolean;
  /** Justin only: claim recovery or storage without a signed agreement, with a reason. */
  canOverride: boolean;
}) {
  return (
    <section id="agreement" className="scroll-mt-16 space-y-3 rounded-xl border border-line bg-card p-5" aria-label="Storage and Recovery Agreement" data-sr-agreement={state.status}>
      <h2 className="font-serif text-xl text-navy-deep">Storage &amp; Recovery Agreement</h2>
      {state.status === "signed" || state.status === "covered_by_hire" ? (
        <p className="text-sm" data-sr-signed>
          {storageRecoverySignedLine(state)}{" "}
          <Link href={`/documents/${state.documentId}`} className="text-teal-dark underline">
            Open the signed copy
          </Link>
        </p>
      ) : (
        <>
          {state.status === "override" ? (
            <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-3 py-2 text-sm" data-sr-override>
              {storageRecoverySignedLine(state)}
            </p>
          ) : null}
          <p className="text-sm">
            The client signs this before recovery or storage is claimed. It is the Storage &amp; Recovery page, the relevant terms and the notice of the right to
            cancel from CAS&rsquo;s Hire Pack.
          </p>
          {hasHireCar ? (
            <p className="text-sm text-slate">This client has a hire car. Once the hire agreement is signed with its Storage &amp; Recovery page, nothing more is needed here.</p>
          ) : null}
          {state.produced ? (
            <p className="text-sm" data-sr-produced>
              Version {state.produced.version} produced on {formatUkDate(state.produced.createdAt)}. Not signed yet.{" "}
              <Link href={`/documents/${state.produced.id}`} className="text-teal-dark underline">
                Open it
              </Link>
              {state.produced.missing.length ? ` Missing when produced: ${state.produced.missing.join(", ")}. Add them and produce a new version.` : ""}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <form method="post" action={`/claims/${claimId}/storage-recovery/produce`}>
              <button type="submit" className="rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-navy">
                {state.produced ? "Produce a new version" : "Produce for signature"}
              </button>
            </form>
            {state.produced && state.produced.missing.length === 0 ? (
              <Link href={`/claims/${claimId}/storage-recovery/sign`} className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
                Client signs on screen
              </Link>
            ) : null}
          </div>
          {state.produced && state.produced.missing.length === 0 ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-teal-dark underline">Upload the signed paper copy</summary>
              <form method="post" action={`/claims/${claimId}/storage-recovery/upload`} encType="multipart/form-data" className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  Name signed on the copy
                  <input name="signerName" required defaultValue={clientName} className={field} />
                </label>
                <label className="block">
                  Signed copy (photo or PDF)
                  <input name="signedCopy" type="file" required accept="image/*,application/pdf" className={field} />
                </label>
                <p className="text-xs text-slate sm:col-span-2">The date recorded is today, the day it is uploaded.</p>
                <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white sm:col-span-2 sm:w-fit">
                  Upload signed copy
                </button>
              </form>
            </details>
          ) : null}
          {canOverride && state.status === "not_signed" ? (
            <details className="text-sm" data-sr-override-form>
              <summary className="cursor-pointer text-teal-dark underline">Claim without a signed agreement (Justin&rsquo;s override)</summary>
              <form method="post" action={`/claims/${claimId}/storage-recovery/override`} className="mt-3 space-y-3">
                <label className="block">
                  Reason (kept on the file and shown in the history and the chronology)
                  <textarea name="reason" required minLength={5} rows={3} className={field} />
                </label>
                <button type="submit" className="rounded-md border border-overdue/40 bg-white px-3 py-2 text-sm font-semibold text-overdue">
                  Authorise the override
                </button>
              </form>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}
