import Link from "next/link";
import { notFound } from "next/navigation";
import { SigningFields } from "@/components/esign/SigningFields";
import { ValuationAnswerFields } from "@/components/esign/ValuationAnswerFields";
import { isOfficeRole } from "@/lib/auth/roles";
import { requireSignedIn } from "@/lib/auth/session";
import { formatUkDateTime } from "@/lib/dates";
import { clientDraftInfo } from "@/lib/documents/client-drafts";
import { clientDocumentSignature, isSignableDraft, signableDocument, signingRefusal } from "@/lib/db/client-document-signing";
import { getClaim } from "@/lib/db/queries";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

/** R64: the client signs Draft 1 or Draft 2 on this screen, by an emailed link, or on paper (uploaded here). */
export default async function ClientDocumentSigningPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; key: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const staff = await requireSignedIn();
  const { id, key } = await params;
  const { error, done } = await searchParams;
  if (!isSignableDraft(key)) notFound();
  const data = getClaim(id);
  if (!data) notFound();
  const info = clientDraftInfo(key)!;
  const signature = clientDocumentSignature(id, key);
  const refusal = signature ? null : signingRefusal(id, key);
  const doc = signableDocument(id, key);
  const clientName = String(data.claim.client_name || "");
  const clientEmail = String(data.claim.client_email || "");
  const action = `/claims/${id}/sign-form/${key}/act`;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <p className="text-sm">
        <Link href={isOfficeRole(staff.role) ? `/claims/${id}/first-letters#letter-${key}` : "/jobs"} className="text-teal-dark underline">
          {isOfficeRole(staff.role) ? "Back to First letters" : "Back to my jobs"}
        </Link>
      </p>
      <h1 className="font-serif text-2xl text-navy-deep">Client signs: {info.title}</h1>
      {error ? <p data-form-error className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-base text-overdue">{error}</p> : null}
      {done ? <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm text-ok">{done}</p> : null}
      {signature ? (
        <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-base" data-signed-done>
          Signed by {signature.signerName} on {formatUkDateTime(signature.signedAt)} ({signature.route === "paper" ? "paper copy" : signature.route === "link" ? "by link" : "on screen"}).{" "}
          <Link href={`/documents/${signature.signedDocumentId}`} className="text-teal-dark underline">
            Open the signed copy
          </Link>
        </p>
      ) : refusal ? (
        <p className="text-base" data-sign-refused>
          {refusal}
        </p>
      ) : doc ? (
        <>
          <p className="text-base font-semibold">
            Hand the screen to {clientName || "the client"}. They read it, {key === "draft_tl_client" ? "tick A, B or C" : `tick clause ${info.tickClause}`} and sign at the bottom.
          </p>
          <div className="letter max-h-[55vh] overflow-y-auto rounded-xl border border-line bg-white p-4 text-sm" dangerouslySetInnerHTML={{ __html: doc.bodyHtml }} />
          <form method="post" action={action} className="space-y-5 rounded-xl border border-line bg-card p-4">
            <input type="hidden" name="intent" value="screen" />
            {key === "draft_tl_client" ? (
              <ValuationAnswerFields />
            ) : (
              <label className="flex items-start gap-3 text-base">
                <input type="checkbox" name="startNow" value="yes" required className="mt-1 h-5 w-5" />
                Clause {info.tickClause}: I ask CAS to start immediately, within the cancellation period. I have been given CAS&apos;s cancellation notice.
              </label>
            )}
            <SigningFields defaultName={clientName} agreementName={info.title.toLowerCase()} />
            <button type="submit" className="min-h-12 w-full rounded-md bg-navy px-4 py-3 text-base font-semibold text-white sm:w-auto">
              Sign
            </button>
          </form>
          {isOfficeRole(staff.role) ? (
            <>
              <form method="post" action={action} className="space-y-3 rounded-xl border border-line bg-card p-4 text-sm">
                <input type="hidden" name="intent" value="link" />
                <p className="font-semibold">Or send a signing link (simulated until the mailbox is connected)</p>
                <label className="block">
                  Client&apos;s email
                  <input name="to" type="email" required defaultValue={clientEmail} className={field} />
                </label>
                <button type="submit" className="rounded-md border border-line bg-white px-3 py-2 font-semibold text-navy">
                  Send the signing link
                </button>
              </form>
              <details className="rounded-xl border border-line bg-card p-4 text-sm">
                <summary className="cursor-pointer font-semibold">Or upload the signed paper copy</summary>
                <form method="post" action={action} encType="multipart/form-data" className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="intent" value="paper" />
                  <label className="block">
                    Name signed on the copy
                    <input name="signerName" required defaultValue={clientName} className={field} />
                  </label>
                  <label className="block">
                    Signed copy (photo or PDF)
                    <input name="signedCopy" type="file" required accept="image/*,application/pdf" className={field} />
                  </label>
                  {key === "draft_tl_client" ? (
                    <div className="sm:col-span-2">
                      <p className="font-semibold">The answer the client ticked on the paper copy</p>
                      <ValuationAnswerFields />
                    </div>
                  ) : (
                    <label className="flex items-start gap-2 sm:col-span-2">
                      <input type="checkbox" name="startNowTicked" value="yes" required className="mt-1" />
                      The client ticked clause {info.tickClause} (starting straight away) on the paper copy.
                    </label>
                  )}
                  <p className="text-xs text-slate sm:col-span-2">The date recorded is today, the day it is uploaded.</p>
                  <button type="submit" className="rounded-md bg-navy px-3 py-2 font-semibold text-white sm:col-span-2 sm:w-fit">
                    Upload signed copy
                  </button>
                </form>
              </details>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
