import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ClaimTable";
import { ScreenForm } from "@/components/claim-file/ScreenForm";
import { ChargeDecisionPanel } from "@/components/claims/ChargeDecisionPanel";
import { ChargeOffers } from "@/components/claims/ChargeOffers";
import { FigureResolution } from "@/components/claims/FigureResolution";
import { HeadAgreedForm } from "@/components/claims/HeadAgreedForm";
import { HeadOfLossScreen } from "@/components/claims/HeadOfLossScreen";
import { PaymentReviewPanel } from "@/components/claims/PaymentReviewPanel";
import { requireStaff } from "@/lib/auth/session";
import { getClaimScreen } from "@/lib/claim-screens";
import { formatUkDate } from "@/lib/dates";
import { headScreenPath } from "@/lib/domain/head-screen";
import { formatGbp } from "@/lib/money";
import { latestChargeDecision } from "@/lib/db/charge-decision";
import { figureFlag, refreshFollowedFigure } from "@/lib/db/figure-resolution";
import { loadHeadSection } from "@/lib/db/head-screen";
import { accountCanAcceptPaymentSettlement, accountCanApproveSettlement } from "@/lib/db/permissions";
import { getClaim, listKnownAgents, listKnownInsurers } from "@/lib/db/queries";
import { seedScreenDefaults } from "@/lib/db/screens";
import { recoveryCarrierName, recoveryClaimForClaim, recoveryJobForClaim, syncRecoveryClaimed } from "@/lib/db/storage-charge";
import { getDefaultVehicleLocation } from "@/lib/db/vehicle-location";
import { getScreenData } from "@/lib/db/screens";
import { agreedOnFor, listChargeOffers } from "@/lib/db/vehicle-offers";

function shownDay(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return "Not recorded";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const [year, month, day] = text.slice(0, 10).split("-");
    return `${day}/${month}/${year}`;
  }
  return formatUkDate(text);
}

export default async function RecoveryHeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; field?: string; figureError?: string; offerError?: string; decisionError?: string }>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  const query = await searchParams;
  const data = getClaim(id);
  if (!data) notFound();
  const def = getClaimScreen("recovery");
  if (!def) notFound();
  refreshFollowedFigure(id, "recovery");
  const decision = syncRecoveryClaimed(id);
  const job = recoveryJobForClaim(id);
  const screen = getScreenData(id, "recovery");
  const storage = getScreenData(id, "storage");
  const storedTo = [storage.name, storage.address, storage.postcode].map((part) => String(part || "").trim()).filter(Boolean).join(", ");
  const from = String(job?.location || screen.location || "").trim();
  const who = recoveryCarrierName(id) || String(screen.name || "").trim();
  const date = job?.recovered_at || screen.recoveryDate || "";
  const section = loadHeadSection(id, "recovery");
  const calculated = decision.totalPence > 0 ? decision.totalPence : null;
  const flag = figureFlag(id, "recovery", section.claimedPence, calculated);
  const values = seedScreenDefaults(id, "recovery");
  const chargeNote =
    decision.source === "screen"
      ? "This claimed figure is the total already calculated on the recovery screen: the standard charge, any extras and the card fee, plus VAT. It is not a second £395 on top."
      : decision.source === "job"
        ? "This claimed figure is the recovery job charges, plus VAT."
        : decision.source === "kept"
          ? "A claimed figure is already on this file. Opening this page has not replaced it, and it has not added another £395."
          : "This is the standard recovery charge of £395, plus VAT. Nothing else has been added.";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recovery"
        subtitle={`${String(data.claim.file_reference)} · ${String(data.claim.client_name || "Unknown client")}`}
      />
      <p className="text-sm">
        <Link href={`/claims/${id}`} className="text-teal-dark underline">
          Back to the file
        </Link>
        {" · "}
        <Link href={headScreenPath(id, "storage")} className="text-teal-dark underline">
          Storage
        </Link>
      </p>
      {query.error ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{query.error}</p>
      ) : null}

      <section className="space-y-3 rounded-xl border border-line bg-card p-5" aria-label="Recovery details">
        <h2 className="font-serif text-xl text-navy-deep">Recovery details</h2>
        <p className="text-sm text-slate">Taken from the recovery job and the recovery screen. Saving the charges below does not change a storage date.</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate">Date</dt>
            <dd>{shownDay(date)}</dd>
          </div>
          <div>
            <dt className="text-slate">From</dt>
            <dd>{from || "Not recorded"}</dd>
          </div>
          <div>
            <dt className="text-slate">To</dt>
            <dd>{storedTo || `${getDefaultVehicleLocation()} — the CAS premises, because no storage address is saved on this file`}</dd>
          </div>
          <div>
            <dt className="text-slate">Who carried it out</dt>
            <dd>{who || "Not recorded"}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-card p-5" aria-label="Recovery charge">
        <h2 className="font-serif text-xl text-navy-deep">Recovery charge</h2>
        <p className="text-sm">{chargeNote}</p>
        <p className="text-sm font-semibold tabular">
          Net {formatGbp(decision.netPence)} · VAT {formatGbp(decision.vatPence)} · Total {formatGbp(decision.totalPence)}
        </p>
        {query.figureError ? <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">{query.figureError}</p> : null}
        {query.offerError ? <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">{query.offerError}</p> : null}
        {query.decisionError ? <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">{query.decisionError}</p> : null}
        <FigureResolution
          claimId={id}
          head="recovery"
          differs={flag.differs}
          keptLabel={flag.mode === "kept" ? flag.label : null}
          storedPence={section.claimedPence}
          calculatedPence={calculated}
        />
        <ScreenForm
          claimId={id}
          actorId={staff.id}
          def={def}
          values={values}
          saved={query.saved === "1"}
          clientRole={String(data.claim.client_role || "")}
          insurers={listKnownInsurers()}
          agents={listKnownAgents()}
          error={query.error}
          errorField={query.field}
        />
      </section>

      <HeadOfLossScreen
        claimId={id}
        section={section}
        canAccept={accountCanAcceptPaymentSettlement(staff.id, staff.role)}
        actions={
          <>
            <HeadAgreedForm claimId={id} head="recovery" />
            <div className="mt-4">
              <PaymentReviewPanel
                claimId={id}
                lockedHead={{
                  head: "recovery",
                  label: "Recovery",
                  receivedPence: section.receivedPence,
                  agreedPence: section.agreedPence || 0,
                  claimedPence: section.claimedPence,
                }}
              />
            </div>
          </>
        }
      />
      <ChargeDecisionPanel
        claimId={id}
        head="recovery"
        decision={latestChargeDecision(id, "recovery")}
        canApproveSettlement={accountCanApproveSettlement(staff.id, staff.role)}
      />
      <ChargeOffers
        claimId={id}
        head="recovery"
        offers={listChargeOffers(id, "recovery")}
        claimedPence={section.claimedPence}
        claimedUnderReview={flag.differs}
        agreedOn={agreedOnFor(id, "recovery")}
        hasAgreed={(section.agreedPence || 0) > 0}
      />
    </div>
  );
}
