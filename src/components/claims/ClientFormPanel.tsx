import { formatUkDate, formatUkDateTime } from "@/lib/dates";
import { type ClientReview, defaultDocumentType } from "@/lib/db/client-form";
import { CLAIM_DOCUMENT_TYPES } from "@/lib/domain/claim-documents";

const NOTICES: Record<string, string> = {
  "link-sent": "Client form link sent. The email is on the Messages tab.",
  "link-simulated": "Client form link prepared and filed on the Messages tab. Email is simulated in this prototype, so nothing reached a real mailbox.",
  "link-off": "The client form link no longer works.",
  applied: "The ticked answers are on the claim. Each change is on the history with its old and new value.",
  "upload-added": "The upload is on the claim's documents.",
  "upload-rejected": "The upload was not added to the claim.",
};

const STATUS: Record<string, string> = {
  not_started: "Not opened yet",
  draft: "Started, not sent",
  submitted: "Sent by the client",
};

/**
 * The client's secure form, for staff (J14). The client's answers sit beside what the claim holds. Nothing changes on
 * the claim until a ticked answer is applied or an upload is accepted.
 */
export function ClientFormPanel({
  claimId,
  review,
  clientEmail,
  notice,
  error,
}: {
  claimId: string;
  review: ClientReview;
  clientEmail: string;
  notice?: string;
  error?: string;
}) {
  const live = review.links.find((link) => !link.revoked && link.expiresAt > new Date().toISOString());
  const waiting = review.uploads.filter((upload) => !upload.decision);
  const decided = review.uploads.filter((upload) => upload.decision);
  return (
    <section id="client-form" className="rounded-xl border border-line bg-card p-4" data-client-form-panel>
      <h2 className="font-serif text-xl text-navy-deep">Client form</h2>
      <p className="mt-1 text-sm text-slate">
        A secure link the client opens on their phone to give their details and add photos and papers. They see only what they enter. Nothing they send
        changes this claim until you apply it here.
      </p>
      {error ? <p className="mt-3 rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">{error}</p> : null}
      {notice && NOTICES[notice] ? <p className="mt-3 rounded-md border border-teal/40 bg-[#eef8f6] px-4 py-3 text-sm">{NOTICES[notice]}</p> : null}

      {live ? (
        <div className="mt-3 text-sm" data-client-link-live>
          <p>
            <span className="font-semibold">{STATUS[live.status] || live.status}.</span> The link works until {formatUkDate(live.expiresAt)}.
            {live.savedAt ? ` Last saved ${formatUkDateTime(live.savedAt)}.` : ""}
            {live.submittedAt ? ` Sent ${formatUkDateTime(live.submittedAt)}.` : ""}
          </p>
          <form method="post" action={`/claims/${claimId}/client-form`} className="mt-2">
            <input type="hidden" name="intent" value="revoke" />
            <input type="hidden" name="linkId" value={live.id} />
            <button type="submit" className="min-h-11 rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold">
              Switch the link off
            </button>
          </form>
        </div>
      ) : null}

      <form method="post" action={`/claims/${claimId}/client-form`} className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="intent" value="send_link" />
        <label className="text-sm font-medium">
          Client&apos;s email
          <input name="to" type="email" defaultValue={clientEmail} className="mt-1 block w-72 max-w-full rounded-md border border-line bg-white px-3 py-2 text-base" />
        </label>
        <button type="submit" className="min-h-11 rounded-md bg-teal px-3 py-2 text-sm font-semibold text-white">
          {live ? "Send a new link" : "Send the client form link"}
        </button>
      </form>
      {live ? <p className="mt-1 text-xs text-slate">A new link replaces the old one. What the client has entered is kept.</p> : null}

      {review.latest && review.proposals.length ? (
        <form method="post" action={`/claims/${claimId}/client-form`} className="mt-4" data-client-proposals>
          <input type="hidden" name="intent" value="apply" />
          <input type="hidden" name="linkId" value={review.latest.linkId} />
          <h3 className="font-semibold text-navy-deep">The client&apos;s answers</h3>
          <p className="text-sm text-slate">
            {review.latest.status === "submitted" ? "Sent by the client." : "The client has saved these but not sent them yet."} Tick the answers to put on the
            claim. Answers about the other vehicle are put on the history for you to enter where they belong.
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-slate">
                  <th className="py-1 pr-2">Apply</th>
                  <th className="py-1 pr-2">Question</th>
                  <th className="py-1 pr-2">On the claim now</th>
                  <th className="py-1">The client says</th>
                </tr>
              </thead>
              <tbody>
                {review.proposals.map((row) => (
                  <tr key={row.name} className="border-t border-line align-top">
                    <td className="py-2 pr-2">
                      {row.same ? (
                        <span className="text-slate">Same</span>
                      ) : (
                        <input type="checkbox" name="field" value={row.name} aria-label={`Apply ${row.label}`} className="h-5 w-5" />
                      )}
                    </td>
                    <td className="py-2 pr-2">{row.label}</td>
                    <td className="whitespace-pre-line py-2 pr-2">{row.applies ? row.current || "Blank" : "No box on the claim"}</td>
                    <td className="whitespace-pre-line break-words py-2">{row.proposed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="submit" className="mt-2 min-h-11 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
            Apply the ticked answers
          </button>
        </form>
      ) : review.links.length ? (
        <p className="mt-4 text-sm">The client has not entered any answers yet.</p>
      ) : null}

      {waiting.length ? (
        <div className="mt-4" data-client-uploads-waiting>
          <h3 className="font-semibold text-navy-deep">Uploads to check</h3>
          <p className="text-sm text-slate">Open each file before adding it. Files from the client are not on the claim until you add them.</p>
          <ul className="mt-2 space-y-3">
            {waiting.map((upload) => (
              <li key={upload.id} className="rounded-lg border border-line px-3 py-3 text-sm">
                <p className="font-semibold">
                  {upload.kind}: <span className="break-words font-normal">{upload.filename}</span>
                </p>
                <p className="text-slate">Added {formatUkDateTime(upload.uploadedAt)}</p>
                <a className="text-teal-dark underline" href={`/claims/${claimId}/client-form/file/${upload.id}`} target="_blank" rel="noreferrer">
                  Open the file
                </a>
                <form method="post" action={`/claims/${claimId}/client-form`} className="mt-2 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="uploadId" value={upload.id} />
                  <label className="text-sm font-medium">
                    File it as
                    <select name="documentType" defaultValue={defaultDocumentType(upload.kindValue)} className="mt-1 block rounded-md border border-line bg-white px-3 py-2 text-base">
                      {CLAIM_DOCUMENT_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" name="intent" value="accept" className="min-h-11 rounded-md bg-teal px-3 py-2 text-sm font-semibold text-white">
                    Add to the claim
                  </button>
                  <button type="submit" name="intent" value="reject" className="min-h-11 rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold">
                    Do not add
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {decided.length ? (
        <p className="mt-3 text-sm text-slate">
          Checked uploads: {decided.map((upload) => `${upload.filename} (${upload.decision === "accepted" ? "added" : "not added"})`).join(", ")}.
        </p>
      ) : null}
    </section>
  );
}
