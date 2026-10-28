import Link from "next/link";
import { notFound } from "next/navigation";
import { SigningFields } from "@/components/esign/SigningFields";
import { isOfficeRole } from "@/lib/auth/roles";
import { requireSignedIn } from "@/lib/auth/session";
import { latestAgreementDocument, latestEsign } from "@/lib/db/esign";
import { signedHireAgreementOnFile } from "@/lib/db/hire-readiness";
import { getClaim } from "@/lib/db/queries";

/** The client signs on this screen: the driver's phone at the doorstep, or an office screen. */
export default async function DoorstepSigningPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; job?: string }>;
}) {
  const staff = await requireSignedIn();
  const { id } = await params;
  const { error, job } = await searchParams;
  const data = getClaim(id);
  if (!data) notFound();
  const back = isOfficeRole(staff.role) ? `/claims/${id}/hire#handover` : `/claims/${id}/handover${job ? `?job=${job}` : ""}`;
  const doc = latestAgreementDocument(id);
  const signed = signedHireAgreementOnFile(id);
  const esign = latestEsign(id);
  const clientName = String(data.claim.client_name || "");
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <p className="text-sm">
        <Link href={back} className="text-teal-dark underline">
          Back to the handover
        </Link>
      </p>
      <h1 className="font-serif text-2xl text-navy-deep">Client signs the hire agreement</h1>
      {signed ? (
        <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-base" data-signed-done>
          Signed{esign?.status === "signed" && esign.signerName ? ` by ${esign.signerName}` : ""}. The signed copy is on the file.
        </p>
      ) : !doc ? (
        <p className="text-base">The office has not produced the agreement yet, so there is nothing to sign.</p>
      ) : doc.missing.length > 0 ? (
        <p className="text-base" data-sign-refused>
          This agreement was produced with details missing. The office must produce a new version before it is signed.
        </p>
      ) : (
        <>
          <p className="text-base">Hand the phone to {clientName || "the client"}. They read the agreement, then sign at the bottom.</p>
          {error ? (
            <p data-form-error className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-base text-overdue">
              {error}
            </p>
          ) : null}
          <p className="text-sm text-slate">{doc.title}</p>
          {/* The agreement exactly as produced. Its text is escaped when the agreement is built. */}
          <div
            className="letter max-h-[55vh] overflow-y-auto rounded-xl border border-line bg-white p-4 text-sm"
            dangerouslySetInnerHTML={{ __html: doc.body_html }}
          />
          <form method="post" action={`/claims/${id}/sign/submit`} className="space-y-5 rounded-xl border border-line bg-card p-4">
            <input type="hidden" name="job" value={job || ""} />
            <SigningFields defaultName={clientName} />
            <button type="submit" className="min-h-12 w-full rounded-md bg-navy px-4 py-3 text-base font-semibold text-white sm:w-auto">
              Sign the agreement
            </button>
          </form>
        </>
      )}
    </div>
  );
}
