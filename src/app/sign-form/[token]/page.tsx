import { SigningFields } from "@/components/esign/SigningFields";
import { openClientDocumentLink } from "@/lib/db/client-document-signing";

/** R64: the client signs Draft 1 or Draft 2 from the emailed link. No CAS sign-in. */
export default async function ClientDocumentLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; signed?: string }>;
}) {
  const { token } = await params;
  const { error, signed } = await searchParams;
  if (signed) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-10" data-sign-thanks>
        <h1 className="font-serif text-2xl text-navy-deep">Thank you</h1>
        <p className="text-base">Your document is signed. Complete Accident Solutions has a copy on your file.</p>
      </main>
    );
  }
  let view: ReturnType<typeof openClientDocumentLink> | null = null;
  let refusal = "";
  try {
    view = openClientDocumentLink(token);
  } catch (problem) {
    refusal = problem instanceof Error ? problem.message : "This signing link cannot be used.";
  }
  if (!view) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-10">
        <h1 className="font-serif text-2xl text-navy-deep">Complete Accident Solutions</h1>
        <p className="text-base" data-sign-refused>
          {refusal}
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <div>
        <p className="text-sm text-slate">Complete Accident Solutions Ltd · {view.fileReference}</p>
        <h1 className="font-serif text-2xl text-navy-deep">{view.title}</h1>
        <p className="mt-1 text-base">Please read it, tick clause {view.tickClause}, then sign at the bottom.</p>
      </div>
      {error ? (
        <p data-form-error className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-base text-overdue">
          {error}
        </p>
      ) : null}
      {/* The document exactly as CAS produced it. Its text is escaped when it is built. */}
      <div className="letter max-h-[60vh] overflow-y-auto rounded-xl border border-line bg-white p-4 text-sm" dangerouslySetInnerHTML={{ __html: view.bodyHtml }} />
      <form method="post" action={`/sign-form/${token}/submit`} className="space-y-5 rounded-xl border border-line bg-card p-4">
        <label className="flex items-start gap-3 text-base">
          <input type="checkbox" name="startNow" value="yes" required className="mt-1 h-5 w-5" />
          Clause {view.tickClause}: I ask CAS to start immediately, within the cancellation period. I have been given CAS&apos;s cancellation notice.
        </label>
        <SigningFields defaultName={view.clientName} agreementName={view.title.toLowerCase()} />
        <button type="submit" className="min-h-12 w-full rounded-md bg-navy px-4 py-3 text-base font-semibold text-white sm:w-auto">
          Sign
        </button>
      </form>
    </main>
  );
}
