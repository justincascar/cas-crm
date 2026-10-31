import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ClaimTable";
import { isOfficeRole } from "@/lib/auth/roles";
import { requireStaff } from "@/lib/auth/session";
import { formatUkDateTime } from "@/lib/dates";
import { firstLettersView, type FirstLetterItem } from "@/lib/db/first-letters";
import { get } from "@/lib/db/connection";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";
const primary = "rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50";
const quiet = "rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-navy disabled:opacity-50";

function doneWords(item: FirstLetterItem): string | null {
  if (!item.done) return null;
  const when = formatUkDateTime(item.done.at);
  if (item.done.action === "sent") return `Sent to ${item.done.recipient || "the recipient"} on ${when} by ${item.done.byName}`;
  if (item.done.action === "marked_sent") return `Marked as sent on ${when} by ${item.done.byName}`;
  return `Generated on the file on ${when} by ${item.done.byName}. Not sent.`;
}

function LetterCard({ claimId, item }: { claimId: string; item: FirstLetterItem }) {
  const sent = item.done && item.done.action !== "generated";
  const blocked = item.waitingWording ? "Waiting for CAS's wording" : !item.approved ? "Waiting for Justin's approval" : null;
  return (
    <li id={`letter-${item.key}`} className="scroll-mt-20 space-y-3 rounded-xl border border-line bg-card p-4" data-first-letter={item.key} data-sent={sent ? "yes" : "no"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-lg text-navy-deep">{item.title}</h2>
        <span className={`text-sm font-semibold ${sent ? "text-ok" : blocked ? "text-overdue" : "text-slate"}`} data-letter-status>
          {doneWords(item) || blocked || (item.missing.length ? "Something missing" : "Ready to check and send")}
        </span>
      </div>
      {blocked && !item.waitingWording ? (
        <p className="text-sm text-slate">It can be read and generated, but not sent or marked as sent until Justin approves it in Settings → Draft documents.</p>
      ) : null}
      {item.error ? <p className="text-sm">{item.error}</p> : null}
      {item.missing.length ? (
        <div className="rounded-md border border-warn bg-[#fff6e8] px-3 py-2 text-sm" data-letter-missing>
          <p className="font-semibold">Missing from the file:</p>
          <ul className="mt-1 list-disc pl-5">
            {item.missing.map((gap) => (
              <li key={gap.label}>
                <Link href={gap.href} className="text-teal-dark underline">
                  {gap.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {item.signed && !item.waitingWording ? (
        <p className="text-sm text-slate">
          The client signs this like the hire agreement, once Justin has approved its wording: on screen, by link or on paper. The tick for starting straight
          away must be ticked to sign.{" "}
          <Link href={`/claims/${claimId}/sign-form/${item.key}`} className="font-semibold text-teal-dark underline" data-sign-form-link>
            Client signs
          </Link>
        </p>
      ) : null}
      {item.waitingWording ? null : (
        <form method="post" action={`/claims/${claimId}/first-letters/act`} className="space-y-3">
          <input type="hidden" name="templateKey" value={item.key} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              To ({item.recipientLabel})
              <input name="to" type="email" defaultValue={item.to} placeholder="No email on the file" className={field} />
            </label>
            {item.recipient === "tp_insurer" ? (
              <label className="text-sm">
                Copy to
                <input name="cc" type="email" defaultValue={item.cc} className={field} />
              </label>
            ) : null}
          </div>
          {item.key === "draft_liability_position" ? (
            <label id="account" className="block text-sm">
              Our client&apos;s account, in one line (typed or checked by you; never written by the CRM)
              <textarea name="accountLine" rows={2} maxLength={400} className={field} placeholder="for example: our client was stationary at the lights when your insured's vehicle struck the rear" />
            </label>
          ) : null}
          <details className="rounded-md border border-line bg-white px-3 py-2 text-sm" data-letter-preview>
            <summary className="cursor-pointer font-semibold">Preview</summary>
            <div className="letter-preview mt-3 overflow-x-auto" dangerouslySetInnerHTML={{ __html: item.html }} />
          </details>
          <div className="flex flex-wrap gap-2">
            <button type="submit" name="intent" value="send" className={primary} disabled={Boolean(blocked) || Boolean(sent)}>
              {item.channel === "email" ? "Send email" : "Send by email (letter attached)"}
            </button>
            {item.channel === "letter" ? (
              <button type="submit" name="intent" value="mark_sent" className={quiet} disabled={Boolean(blocked) || Boolean(sent)}>
                Mark as sent (posted)
              </button>
            ) : null}
            <button type="submit" name="intent" value="generate" className={quiet}>
              Generate on the file
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

/** R63/R64: step 4. The first letters for this file's liability status, prepared filled in and addressed. */
export default async function FirstLettersPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const { id } = await params;
  const { error, done } = await searchParams;
  const staff = await requireStaff();
  if (!isOfficeRole(staff.role)) redirect("/jobs?notice=office");
  const view = firstLettersView(id);
  if (!view) notFound();
  const claim = get<{ file_reference: string }>(`SELECT file_reference FROM claims WHERE id = ?`, [id]);
  const readyCount = view.items.filter((item) => item.approved && !item.waitingWording && (!item.done || item.done.action === "generated") && item.to && !item.missing.length).length;
  return (
    <div className="space-y-4">
      <PageHeader
        title={`First letters · ${claim?.file_reference || ""}`}
        subtitle={`Liability status: ${view.statusLabel}. These letters are prepared from the file. Check each one and send. Email is simulated until CAS's mailbox is connected.`}
        actions={
          <Link href={`/claims/${id}`} className={quiet}>
            Back to the claim
          </Link>
        }
      />
      <p className="text-sm">
        Wrong status?{" "}
        <Link href={`/claims/${id}/details/general`} className="text-teal-dark underline">
          Change the liability status
        </Link>{" "}
        and the letters for the new status are offered. Letters already made stay on the file.
      </p>
      {error ? <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue" role="alert">{error}</p> : null}
      {done ? <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm text-ok">{done}</p> : null}
      <form method="post" action={`/claims/${id}/first-letters/act`}>
        <input type="hidden" name="intent" value="send_all" />
        <button type="submit" className={primary} disabled={readyCount === 0} data-send-all={readyCount}>
          Send all ready ({readyCount})
        </button>
      </form>
      <ul className="space-y-4">
        {view.items.map((item) => (
          <LetterCard key={item.key} claimId={id} item={item} />
        ))}
      </ul>
      {view.earlier.length ? (
        <section className="space-y-3" data-earlier-letters>
          <h2 className="font-serif text-xl text-navy-deep">Letters made for an earlier liability status</h2>
          <p className="text-sm text-slate">Kept on the file. They are not part of this status&apos;s letters.</p>
          <ul className="space-y-4">
            {view.earlier.map((item) => (
              <LetterCard key={item.key} claimId={id} item={item} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
