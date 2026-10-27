/**
 * The three claim journeys. Later stages add steps after "create".
 * A stage is not finished until the journey check for that stage passes.
 *
 * This stage only creates the file: the new-claim form, Skip other number,
 * a telephone warning then Save anyway, Create claim, and step 1 done.
 */

export type JourneyId = "repairable" | "total-loss" | "fault-courtesy";

export type JourneyStage = "create";

export type ClaimJourney = {
  id: JourneyId;
  /** Plain name used on the form. Later stages keep using this same file. */
  title: string;
  forename: string;
  surname: string;
  claimType: "non_fault" | "fault";
  roadworthiness: "unroadworthy" | "roadworthy";
  needsRecovery: boolean;
  needsReplacement: boolean;
  /** What a later stage will do on this same file. Not run in this stage. */
  continues: string;
};

export const JOURNEY_STAGE: JourneyStage = "create";

/** A number that is not a UK telephone, so the form must show Save anyway. */
export const JOURNEY_PHONE_WARNING = "+1 202 555 0143";

export const CLAIM_JOURNEYS: ClaimJourney[] = [
  {
    id: "repairable",
    title: "Non-fault repairable",
    forename: "Journey",
    surname: "Repairable",
    claimType: "non_fault",
    roadworthiness: "unroadworthy",
    needsRecovery: true,
    needsReplacement: true,
    continues: "Hire, repairs, return, then the chasers.",
  },
  {
    id: "total-loss",
    title: "Non-fault total loss",
    forename: "Journey",
    surname: "TotalLoss",
    claimType: "non_fault",
    roadworthiness: "unroadworthy",
    needsRecovery: true,
    needsReplacement: true,
    continues: "Valuation, payment, then salvage. Total loss is set on Assessed damage, not on this form.",
  },
  {
    id: "fault-courtesy",
    title: "Fault courtesy car",
    forename: "Journey",
    surname: "Courtesy",
    claimType: "fault",
    roadworthiness: "roadworthy",
    needsRecovery: false,
    needsReplacement: true,
    continues: "Courtesy car, own insurer, excess, then the invoice. Courtesy is not credit hire.",
  },
];
