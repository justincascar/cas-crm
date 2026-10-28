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

/** Plain words for each pack field, for screens and history. Field codes are never shown. */
export const HIRE_PACK_FIELD_LABELS: Record<string, string> = {
  agreementNumber: "CAS reference",
  hirerName: "hirer's name",
  hirerAddress: "hirer's address",
  hirerDob: "date of birth",
  licenceNumber: "licence number",
  licenceIssuedOn: "licence issue date",
  licenceExpiresOn: "licence expiry date",
  hireMake: "hire car make",
  hireModel: "hire car model",
  hireRegistration: "hire car registration",
  hireTransmission: "hire car gearbox",
  dateOut: "handover date",
  dailyRatePence: "daily rate",
  needReason: "why a hire car is needed",
  clientVehicleRegistration: "client's registration",
  clientName: "client's name",
};

export function plainPackFields(keys: readonly string[]): string {
  return keys.map((key) => HIRE_PACK_FIELD_LABELS[key] || key).join(", ");
}

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
  status: "confirmed",
  note: "Confirmed 27 October 2026. The agreement is 89 days. Renewal alerts start on day 80 and are overdue on day 88. That margin is deliberate. Hire charges are not changed by this alert.",
} as const;
