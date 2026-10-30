import Link from "next/link";
import { notFound } from "next/navigation";
import { SigningFields } from "@/components/esign/SigningFields";
import { isOfficeRole } from "@/lib/auth/roles";
import { requireSignedIn } from "@/lib/auth/session";
import { getClaim } from "@/lib/db/queries";
import { latestStorageRecoveryDocument, storageRecoverySignedLine, storageRecoveryState } from "@/lib/db/storage-recovery-signing";
import { headScreenPath } from "@/lib/domain/head-screen";

/** The client signs the Storage & Recovery Agreement on this screen: the driver's phone at the recovery, or an office screen. */
export default async function StorageRecoverySigningPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const staff = await requireSignedIn();
  const { id } = await params;
  const { error } = await searchParams;
  const data = getClaim(id);
  if (!data) notFound();
  const back = isOfficeRole(staff.role) ? `${headScreenPath(id, "recovery")}#agreement` : "/jobs";
  const state = storageRecoveryState(id);
  const doc = latestStorageRecoveryDocument(id);
  const clientName = String(data.claim.client_name || "");
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <p className="text-sm">
        <Link href={back} className="text-teal-dark underline">
          {isOfficeRole(staff.role) ? "Back to Recovery" : "Back to my jobs"}
        </Link>
      </p>
      <h1 className="font-serif text-2xl text-navy-deep">Client signs the Storage &amp; Recovery Agreement</h1>
      {state.status !== "not_signed" ? (
        <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-base" data-signed-done>
          {storageRecoverySignedLine(state)}
        </p>
      ) : !doc ? (
        <p className="text-base">The office has not produced the agreement yet, so there is nothing to sign.</p>
      ) : doc.missing.length > 0 ? (
        <p className="text-base" data-sign-refused>
          This agreement was produced with details missing. The office must produce a new version before it is signed.
        </p>
      ) : (
        <>
          <p className="text-base font-semibold">Hand the screen to {clientName || "the client"}. They read the agreement, then sign at the bottom.</p>
          {error ? (
            <p data-form-error className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-base text-overdue">
              {error}
            </p>
          ) : null}
          <p className="text-sm text-slate">
            {doc.title}, version {doc.version}
          </p>
          {/* The agreement exactly as produced. Its text is escaped when the agreement is built. */}
          <div
            className="letter max-h-[55vh] overflow-y-auto rounded-xl border border-line bg-white p-4 text-sm"
            dangerouslySetInnerHTML={{ __html: doc.bodyHtml }}
          />
          <form method="post" action={`/claims/${id}/storage-recovery/sign/submit`} className="space-y-5 rounded-xl border border-line bg-card p-4">
            <SigningFields defaultName={clientName} agreementName="Storage & Recovery Agreement" />
            <button type="submit" className="min-h-12 w-full rounded-md bg-navy px-4 py-3 text-base font-semibold text-white sm:w-auto">
              Sign the agreement
            </button>
          </form>
        </>
      )}
    </div>
  );
}
