export const HEADS_OF_LOSS = [
  "hire",
  "credit_hire",
  "courtesy",
  "recovery",
  "storage",
  "gate_fee",
  "cdw",
  "additional_driver",
  "delivery_collection",
  "repairs",
  "vehicle_damage",
  "salvage_shortfall",
  "engineers_fees",
  "other",
] as const;

export type HeadOfLoss = (typeof HEADS_OF_LOSS)[number];

export const HEAD_LABELS: Record<HeadOfLoss, string> = {
  hire: "Hire",
  credit_hire: "Credit hire",
  courtesy: "Courtesy vehicle",
  recovery: "Recovery",
  storage: "Storage",
  gate_fee: "Gate fee",
  cdw: "Collision damage waiver",
  additional_driver: "Additional driver",
  delivery_collection: "Delivery / collection",
  repairs: "Repairs",
  vehicle_damage: "Vehicle damage",
  salvage_shortfall: "Salvage shortfall",
  engineers_fees: "Engineer's fees",
  other: "Other",
};

export const INDICATIVE_DEFAULTS = {
  storage_per_day_net_pence: 3900,
  recovery_net_pence: 39500,
  gate_fee_net_pence: 19900,
  cdw_per_day_net_pence_range: [1500, 2000] as const,
  additional_driver_per_day_net_pence_range: [2000, 2500] as const,
  delivery_collection_net_pence: 20000,
  vat_rate: 0.2,
};

/** Where a recovered vehicle is taken unless a claim records a different location. Editable in Settings. */
export const SETTING_DEFAULT_VEHICLE_LOCATION = "default_vehicle_location";
export const DEFAULT_VEHICLE_LOCATION =
  "Complete Accident Solutions Ltd, 171 Cwmgarw Road, Brynamman, Ammanford SA18 1DG";

export const AGREEMENT_MAX_DAYS_DEFAULT = 88;
export const AGREEMENT_RENEWAL_ALERT_DAY_DEFAULT = 80;
export const TOTAL_LOSS_HIRE_DAYS_AFTER_QUALIFYING_PAYMENT = 7;
/** Calendar days after the request is marked sent before a chase reminder is due. Editable in Settings; overridable per claim. */
export const SETTING_ENGINEER_CHASE_INTERVAL_DAYS = "chaser_interval_days";
export const SETTING_LIABILITY_CHASE_INTERVAL_DAYS = "liability_chase_interval_days";
export const SETTING_REPAIR_AUTH_CHASE_INTERVAL_DAYS = "repair_auth_chase_interval_days";
export const ENGINEER_CHASER_INTERVAL_DAYS_DEFAULT = 3;
export const ENGINEER_INSTRUCTION_CHASE_RULE = "engineer_instruction_chase";
export const ENGINEER_REPORT_CHASE_TEMPLATE = "engineer_report_chase";
export const ENGINEER_REPORT_CHASE_DUE_LABEL = "Engineer report chase due";
export const LIABILITY_RESPONSE_CHASE_RULE = "liability_response_chase";
export const LIABILITY_RESPONSE_CHASE_TEMPLATE = "liability_response_chase";
export const LIABILITY_RESPONSE_CHASE_DUE_LABEL = "Liability response chase due";
export const REPAIR_AUTHORISATION_CHASE_RULE = "repair_authorisation_chase";
export const REPAIR_AUTHORISATION_CHASE_TEMPLATE = "repair_authorisation_chase";
export const REPAIR_AUTHORISATION_CHASE_DUE_LABEL = "Repair authorisation chase due";
export const FILE_REFERENCE_PREFIX_DEFAULT = "TEST-";

/** Confirmed Microsoft 365 claims mailbox. Live send/receive is not connected. */
export const CAS_CLAIMS_MAILBOX = "claims@cascar.co.uk";
