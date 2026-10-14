import { VehicleOffers } from "@/components/claims/VehicleOffers";
import type { VehicleOffer } from "@/lib/db/vehicle-offers";

/** Hire, storage and recovery use the same offer list as vehicle damage. */
export function ChargeOffers({
  claimId,
  head,
  offers,
  claimedPence,
  claimedUnderReview = false,
  agreedOn,
  hasAgreed,
}: {
  claimId: string;
  head: "hire" | "storage" | "recovery";
  offers: VehicleOffer[];
  claimedPence: number;
  claimedUnderReview?: boolean;
  agreedOn: string | null;
  hasAgreed: boolean;
}) {
  return (
    <VehicleOffers
      claimId={claimId}
      totalLoss={false}
      offers={offers}
      undatedOfferPence={null}
      agreedOn={agreedOn}
      hasAgreed={hasAgreed}
      returnPath={`/claims/${claimId}/heads/${head}`}
      offerHead={head}
      claimedPence={claimedPence}
      claimedUnderReview={claimedUnderReview}
      showDayRate={head === "hire" || head === "storage"}
    />
  );
}
