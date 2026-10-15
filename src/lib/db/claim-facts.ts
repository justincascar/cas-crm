import { updateClaimPosition } from "./queries";
import { claimSectionForSave, withImmediateTransaction } from "./record-version";
import {
  CIRCUMSTANCE_FIELDS,
  OWN_INSURER_FIELDS,
  SHARED_CIRCUMSTANCES,
  SHARED_INSURER_POSITION,
  SHARED_OWN_INSURER,
  claimColumns,
  guardSharedFields,
} from "./shared-fields";

export function saveClaimOverview(input: {
  claimId: string;
  actorId: string;
  submitted: Record<string, string>;
  overviewVersion: string;
  circumstancesVersion?: string;
  ownInsurerVersion?: string;
  insurerPositionVersion?: string;
}) {
  withImmediateTransaction(() => {
    guardSharedFields({
      scope: SHARED_CIRCUMSTANCES,
      recordKey: input.claimId,
      expected: input.circumstancesVersion,
      actorId: input.actorId,
      current: claimColumns(input.claimId, CIRCUMSTANCE_FIELDS),
      next: {
        circumstances: input.submitted.circumstances || "",
        accident_location: input.submitted.accident_location || "",
      },
      labels: { circumstances: "Circumstances", accident_location: "Location" },
      submitted: input.submitted,
    });
    guardSharedFields({
      scope: SHARED_OWN_INSURER,
      recordKey: input.claimId,
      expected: input.ownInsurerVersion,
      actorId: input.actorId,
      current: claimColumns(input.claimId, OWN_INSURER_FIELDS),
      next: {
        own_insurer_name: input.submitted.own_insurer_name || "",
        own_policy_ref: input.submitted.own_policy_ref || "",
        own_claim_ref: input.submitted.own_claim_ref || "",
        own_insurer_address: input.submitted.own_insurer_address || "",
        own_insurer_postcode: input.submitted.own_insurer_postcode || "",
      },
      labels: {
        own_insurer_name: "Own insurer",
        own_policy_ref: "Policy number",
        own_claim_ref: "Claim reference",
        own_insurer_address: "Insurer address",
        own_insurer_postcode: "Insurer postcode",
      },
      submitted: input.submitted,
    });
    guardSharedFields({
      scope: SHARED_INSURER_POSITION,
      recordKey: input.claimId,
      expected: input.insurerPositionVersion,
      actorId: input.actorId,
      current: claimColumns(input.claimId, ["insurer_liability_position"]),
      next: { insurer_liability_position: input.submitted.insurer_liability_position || "" },
      labels: { insurer_liability_position: "Insurer position" },
      submitted: input.submitted,
    });
    updateClaimPosition(input.claimId, input.submitted, input.actorId);
    claimSectionForSave({
      scope: "claim-overview",
      recordKey: input.claimId,
      expected: input.overviewVersion,
      actorId: input.actorId,
      submitted: input.submitted,
      fields: input.submitted,
    });
  });
}
