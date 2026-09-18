/**
 * Fields required to produce CAS's Hire Pack (supplied example: Hire Pack.doc).
 * Personal data from that example file is not stored here.
 */
export const HIRE_PACK_SECTIONS = [
  {
    id: "delivery_sheet",
    title: "Driver delivery sheet",
    audience: "internal",
    note: "Do not give to the client.",
  },
  {
    id: "damage_form",
    title: "Vehicle damage form (hire vehicle)",
    audience: "client",
  },
  {
    id: "mitigation",
    title: "Mitigation questionnaire / statement of truth",
    audience: "client",
  },
  {
    id: "agreement_1",
    title: "Hire agreement page 1 — parties, vehicle and charges",
    audience: "client",
  },
  {
    id: "agreement_2",
    title: "Hire agreement page 2 — terms and conditions",
    audience: "client",
    note: "Wording is the CAS pack supplied on 15/09/2026. Not invented.",
  },
  {
    id: "cancellation",
    title: "Hire agreement page 3 — notice of the right to cancel",
    audience: "client",
  },
  {
    id: "storage_recovery",
    title: "Storage & Recovery Agreement (standalone)",
    audience: "client",
    note: "Separate from the hire agreement. Can be produced when there is recovery/storage but no hire. Solicitor-reviewed standalone wording is still to come.",
  },
  {
    id: "collection_sheet",
    title: "Driver collection sheet",
    audience: "internal",
    note: "Do not give to the client.",
  },
] as const;

export const HIRE_PACK_MANDATORY = [
  "agreementNumber",
  "hirerName",
  "hirerAddress",
  "hirerDob",
  "licenceNumber",
  "licenceIssuedOn",
  "licenceExpiresOn",
  "hireMake",
  "hireModel",
  "hireRegistration",
  "hireTransmission",
  "dateOut",
  "dailyRatePence",
  "needReason",
  "clientVehicleRegistration",
] as const;

/** On the supplied pack, captured even when not required to generate a hire agreement. */
export const HIRE_PACK_OPTIONAL = [
  "satNavPence",
  "additionalDriverPence",
  "handsFreePence",
  "cdwPence",
  "childSeatPence",
  "automaticPence",
  "insuranceDailyPence",
  "estatePence",
  "insurancePence",
  "towBarPence",
  "adminPence",
  "roofRackPence",
  "deliveryCollectionPence",
  "groupCharged",
  "additionalName",
  "additionalDob",
  "additionalLicence",
  "additionalLicenceIssuedOn",
  "additionalLicenceExpiresOn",
] as const;

export const STORAGE_RECOVERY_MANDATORY = ["clientName", "clientVehicleRegistration"] as const;

export const OWN_VEHICLE_DETAILS_HEADING = "Your Own Vehicle Details";

export const STORAGE_RECOVERY_STANDALONE_BANNER =
  "This Storage & Recovery Agreement is a standalone document. It is not a page of the Hire Agreement and can be produced when there is recovery or storage but no hire. Solicitor-reviewed standalone legal wording is still to come. Facts below are taken from the file. Signatures are not fabricated.";

export const RENTAL_PERIOD_DECISION = {
  packDays: 89,
  alertDays: 88,
  status: "awaiting_justin",
  note: "The supplied Hire Pack caps the Rental Period at 89 days. CRM renewal alerts use 88 days. Do not silently pick one — Justin (or the solicitor) must confirm which is correct.",
} as const;
