import { VehicleOffers } from "@/components/claims/VehicleOffers";
import type { VehicleOffer } from "@/lib/db/vehicle-offers";

/** Hire, storage and recovery use the same offer list as vehicle damage. */
export function ChargeOffers({
  claimId,
  head,
  offers,
  claimedPence,
  agreedOn,
  hasAgreed,
}: {
  claimId: string;
  head: "hire" | "storage" | "recovery";
  offers: VehicleOffer[];
  claimedPence: number;
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
      showDayRate={head === "hire" || head === "storage"}
    />
  );
}
