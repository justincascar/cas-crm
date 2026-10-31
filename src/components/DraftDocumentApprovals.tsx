import { formatUkDate, formatUkDateTime, londonTodayIso } from "@/lib/dates";
import type { DraftDocumentRow } from "@/lib/db/draft-previews";

const field = "mt-1 rounded-md border border-line bg-white px-3 py-2 text-sm";

/**
 * R64: Settings → Draft documents. The reviewer's drafts wait here for Justin. Each can be read as it would be produced
 * on a TEST file; until approved it cannot be sent, marked sent or signed. Drafts 1, 2, 4 and 5 also record the date
 * the solicitor checked them.
 */
export function DraftDocumentApprovals({ rows, mayApprove, error }: { rows: DraftDocumentRow[]; mayApprove: boolean; error?: string }) {
  return (
    <section id="draft-documents" className="scroll-mt-24 rounded-xl border border-line bg-card p-5" data-draft-documents>
      <h2 className="font-serif text-xl text-navy-deep">Draft documents waiting for approval</h2>
      <p className="mt-2 text-sm">
        First drafts, by the reviewer, of the letters and forms CAS has not supplied (kept in docs/correspondence-templates/drafts). None is approved. Until Justin approves one it shows &ldquo;DRAFT – wording not approved by
        CAS&rdquo; and cannot be sent, marked as sent or signed. Drafts marked &ldquo;solicitor&rdquo; also need the date CAS&apos;s solicitor checked them.
      </p>
      {error ? <p className="mt-2 rounded-md border border-overdue/40 bg-[#f8ecec] px-3 py-2 text-sm text-overdue">{error}</p> : null}
      <ul className="mt-3 divide-y divide-line text-sm">
        {rows.map((row) => (
          <li key={row.key} className="space-y-2 py-3" data-draft-document={row.key} data-approved={row.approved ? "yes" : "no"}>
            <p>
              <span className="font-semibold">
                {row.number}: {row.title}
              </span>
              {row.solicitor ? <span className="text-slate"> · solicitor</span> : null} ·{" "}
              {row.outlineOnly
                ? "Waiting for CAS's wording"
                : row.approval
                  ? `Approved by ${row.approval.approvedByName} on ${formatUkDateTime(row.approval.approvedAt)}${row.approval.solicitorCheckedOn ? ` · solicitor checked on ${formatUkDate(row.approval.solicitorCheckedOn)}` : row.solicitor ? " · waiting for the solicitor's check date" : ""}`
                  : "Waiting for Justin's approval"}
            </p>
            <details className="rounded-md border border-line bg-white px-3 py-2" data-draft-wording={row.key}>
              <summary className="cursor-pointer font-semibold">Read the wording</summary>
              {row.example ? (
                <>
                  <p className="mt-2 text-xs text-slate">
                    Example on {row.example.fileReference}, made by the same code that produces it. Nothing was filed or sent.
                    {row.example.missing.length ? ` Not on that file: ${row.example.missing.join(", ")}.` : ""}
                  </p>
                  <p className="mt-2">
                    <span className="font-semibold">Heading:</span> {row.example.subject}
                  </p>
                  <pre className="mt-2 whitespace-pre-wrap break-words font-sans">{row.example.text}</pre>
                </>
              ) : (
                <p className="mt-2 text-slate">{row.note}</p>
              )}
            </details>
            {mayApprove && !row.outlineOnly ? (
              row.approval ? (
                <form method="post" action="/settings/document-approval">
                  <input type="hidden" name="templateKey" value={row.key} />
                  <input type="hidden" name="intent" value="withdraw" />
                  <button type="submit" className="rounded-md border border-line bg-white px-3 py-1 text-sm font-semibold text-navy">
                    Withdraw approval
                  </button>
                </form>
              ) : (
                <form method="post" action="/settings/document-approval" className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="templateKey" value={row.key} />
                  <input type="hidden" name="intent" value="approve" />
                  {row.solicitor ? (
                    <label className="text-sm">
                      Date the solicitor checked it
                      <input type="date" name="solicitorCheckedOn" required max={londonTodayIso()} className={field} />
                    </label>
                  ) : null}
                  <button type="submit" className="rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-navy">
                    Approve the wording
                  </button>
                </form>
              )
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
