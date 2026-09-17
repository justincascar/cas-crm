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
    id: "storage_recovery",
    title: "Hire agreement page 3 — storage and recovery of the client's own vehicle",
    audience: "client",
  },
  {
    id: "cancellation",
    title: "Hire agreement page 4 — notice of the right to cancel",
    audience: "client",
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
