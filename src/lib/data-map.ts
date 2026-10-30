/**
 * The data map (J15): every personal-data field the CRM holds, who it is about, why it is held, which roles can see
 * it, where it is stored and how long it is kept. docs/DATA-MAP.md is generated from this and the actual schema by
 * `npm run data-map`; a test fails if a new column that looks personal is not listed here. This feeds the DPIA.
 */

export type DataSubject = "client" | "driver" | "third party" | "witness" | "staff" | "business contact";
export type SpecialCategory = "criminal offence data" | "financial data" | "signature";

export type DataMapEntry = {
  table: string;
  columns: string[];
  about: DataSubject[];
  why: string;
  roles: string;
  retention: string;
  category?: SpecialCategory;
};

const OFFICE = "Justin and office staff";
const OFFICE_DRIVER = "Justin and office staff; a driver sees name, address and phone on a job assigned to them today";
const CLAIM_FILE = "Claim file: 6 years after the claim closes (awaiting adviser)";

export const DATA_MAP: DataMapEntry[] = [
  {
    table: "people",
    columns: ["full_name", "title", "forename", "surname", "date_of_birth", "address_line1", "address_line2", "town", "postcode", "telephone", "email", "home_tel", "work_tel", "mobile_tel", "preferred_channel", "restricted_reason"],
    about: ["client", "driver", "third party"],
    why: "To identify and contact the people on a claim, and to prove who hired the car",
    roles: OFFICE_DRIVER,
    retention: CLAIM_FILE,
  },
  {
    table: "people",
    columns: ["licence_number", "licence_issued_on", "licence_expires_on"],
    about: ["client", "driver"],
    why: "To check the hirer and any named driver may drive the hire car",
    roles: OFFICE,
    retention: CLAIM_FILE,
  },
  {
    table: "licence_checks",
    columns: ["driver_name", "category", "licence_expires_on", "checked_on", "check_code"],
    about: ["client", "driver"],
    why: "The pre-hire licence check: categories, expiry and the date checked",
    roles: OFFICE,
    retention: "Follows the claim file",
  },
  {
    table: "licence_checks",
    columns: ["points_endorsements", "penalty_points", "notes"],
    about: ["client", "driver"],
    why: "Penalty points and endorsement codes relevant to the hire, or \"No points\". Notes are no longer kept (always empty)",
    roles: OFFICE,
    retention: "Follows the claim file",
    category: "criminal offence data",
  },
  {
    table: "claims",
    columns: ["accident_location", "circumstances", "police_details", "own_insurer_name", "own_insurer_address", "own_insurer_postcode", "legal_hold_reason"],
    about: ["client", "third party"],
    why: "What happened, where, and the client's own insurer, to pursue the claim",
    roles: OFFICE,
    retention: CLAIM_FILE,
  },
  {
    table: "claim_third_parties",
    columns: ["insurer_name", "insurer_address", "insurer_postcode", "insurer_tel", "insurer_email", "policy_number", "insurer_ref", "representative", "handler_name", "handler_email", "handler_tel", "agent_name", "agent_address", "agent_postcode", "agent_tel", "agent_email", "agent_ref", "agent_handler_name", "agent_handler_email", "agent_handler_tel"],
    about: ["third party", "business contact"],
    why: "The at-fault party's insurer or agent and the person handling the claim there, to recover the costs",
    roles: OFFICE,
    retention: CLAIM_FILE,
  },
  {
    table: "claim_witnesses",
    columns: ["full_name", "telephone", "postcode", "address_line1", "town"],
    about: ["witness"],
    why: "To contact a witness about how the accident happened",
    roles: OFFICE,
    retention: CLAIM_FILE,
  },
  {
    table: "claim_screen_data",
    columns: ["data_json"],
    about: ["client", "driver", "third party", "witness"],
    why: "The claim screens as staff saved them (contact details, accident details, conviction yes/no only)",
    roles: OFFICE,
    retention: CLAIM_FILE,
  },
  {
    table: "hire_pack_data",
    columns: ["home_tel", "work_tel", "mobile_tel", "licence_issued_on", "licence_expires_on", "additional_name", "additional_address", "additional_dob", "additional_licence", "additional_licence_issued_on", "additional_licence_expires_on", "delivery_address", "driver_name"],
    about: ["client", "driver"],
    why: "The hire agreement: the hirer, any additional driver and where the car is delivered",
    roles: OFFICE,
    retention: CLAIM_FILE,
  },
  {
    table: "hire_pack_data",
    columns: ["means_notes"],
    about: ["client"],
    why: "The client's statement of means, where impecuniosity is relied on",
    roles: OFFICE,
    retention: CLAIM_FILE,
    category: "financial data",
  },
  {
    table: "financial_circumstances",
    columns: ["no_bank_explanation"],
    about: ["client"],
    why: "Why the client has no bank account, in place of bank statements",
    roles: OFFICE,
    retention: "Bank statements: at claim close unless used in a dispute (awaiting adviser)",
    category: "financial data",
  },
  {
    table: "impecuniosity_accounts",
    columns: ["notes"],
    about: ["client"],
    why: "The client's accounts listed for an impecuniosity review",
    roles: OFFICE,
    retention: CLAIM_FILE,
    category: "financial data",
  },
  {
    table: "impecuniosity_concerns",
    columns: ["body"],
    about: ["client"],
    why: "Concerns raised on the client's means",
    roles: OFFICE,
    retention: CLAIM_FILE,
    category: "financial data",
  },
  {
    table: "documents",
    columns: ["body_html", "original_filename", "stored_relpath", "title"],
    about: ["client", "driver", "third party", "witness"],
    why: "Letters produced and files uploaded to the claim. Bank statements (type bank_statements) are financial data; licence check screenshots (type licence_check) are criminal offence data; both are office only",
    roles: OFFICE,
    retention: "Claim file; bank statements at claim close unless used in a dispute (awaiting adviser)",
  },
  {
    table: "correspondence",
    columns: ["subject", "preview", "body", "to_address", "from_address"],
    about: ["client", "third party", "business contact"],
    why: "Emails, letters and calls filed on the claim",
    roles: OFFICE,
    retention: CLAIM_FILE,
  },
  {
    table: "claim_events",
    columns: ["details"],
    about: ["client", "driver", "third party"],
    why: "The dated history of the claim",
    roles: OFFICE,
    retention: CLAIM_FILE,
  },
  {
    table: "notes",
    columns: ["body"],
    about: ["client", "third party"],
    why: "Staff notes on the claim",
    roles: OFFICE,
    retention: CLAIM_FILE,
  },
  {
    table: "tasks",
    columns: ["details"],
    about: ["client"],
    why: "Work for staff on the claim",
    roles: OFFICE,
    retention: CLAIM_FILE,
  },
  {
    table: "vehicle_handovers",
    columns: ["signature_name", "signature_relationship", "signature_png", "signature_skip_reason"],
    about: ["client", "driver"],
    why: "Who signed for the car at a handover",
    roles: OFFICE_DRIVER,
    retention: CLAIM_FILE,
    category: "signature",
  },
  {
    table: "handovers",
    columns: ["condition_notes"],
    about: ["client"],
    why: "The car's condition at a handover",
    roles: OFFICE_DRIVER,
    retention: CLAIM_FILE,
  },
  {
    table: "esign_requests",
    columns: ["signer_name", "signature_png", "device", "ip", "sent_to"],
    about: ["client"],
    why: "Evidence of an electronic signature on the hire agreement",
    roles: OFFICE,
    retention: CLAIM_FILE,
    category: "signature",
  },
  {
    table: "storage_recovery_signatures",
    columns: ["signer_name", "signature_png", "device", "ip"],
    about: ["client"],
    why: "Evidence of a signature on the Storage & Recovery Agreement",
    roles: OFFICE,
    retention: CLAIM_FILE,
    category: "signature",
  },
  {
    table: "client_form_links",
    columns: ["data_json"],
    about: ["client", "third party"],
    why: "What the client typed on the secure client form, until staff review it",
    roles: OFFICE,
    retention: CLAIM_FILE,
  },
  {
    table: "client_form_uploads",
    columns: ["original_filename", "stored_relpath"],
    about: ["client"],
    why: "Photos and papers the client uploaded, held apart until staff accept them",
    roles: OFFICE,
    retention: CLAIM_FILE,
  },
  {
    table: "litigation_parties",
    columns: ["name", "representative_name", "representative_firm", "representative_ref", "contact"],
    about: ["client", "third party", "business contact"],
    why: "Parties to a dispute and their representatives",
    roles: OFFICE,
    retention: CLAIM_FILE,
  },
  {
    table: "vehicles",
    columns: ["registration"],
    about: ["client", "third party"],
    why: "The vehicles on a claim. A registration can identify the keeper only with a lookup the CRM does not make",
    roles: "Justin, office staff, and a driver or mechanic for a job assigned to them today",
    retention: CLAIM_FILE,
  },
  {
    table: "mid_lookups",
    columns: ["registration"],
    about: ["third party"],
    why: "Insurance lookups made on a registration (simulated in the prototype)",
    roles: OFFICE,
    retention: CLAIM_FILE,
  },
  {
    table: "staff",
    columns: ["name", "email", "username", "password_hash", "totp_secret", "totp_enabled_at", "external_subject"],
    about: ["staff"],
    why: "Staff sign-in. Passwords are stored only as a one-way hash; the authenticator key is needed to check codes",
    roles: "Justin (administrator); each person sees their own sign-in",
    retention: "While the person works for CAS, then removed (awaiting adviser)",
  },
  {
    table: "login_attempts",
    columns: ["username"],
    about: ["staff"],
    why: "Failed and successful sign-ins, for the lockout after repeated failures",
    roles: "Justin",
    retention: "Audit log: 6 years (awaiting adviser)",
  },
  {
    table: "audit_log",
    columns: ["details"],
    about: ["staff", "client"],
    why: "Who changed, viewed or exported what, and when",
    roles: "Justin",
    retention: "Audit log: 6 years (awaiting adviser)",
  },
  {
    table: "engineers",
    columns: ["name", "address", "email"],
    about: ["business contact"],
    why: "Engineers CAS instructs",
    roles: OFFICE,
    retention: "While CAS works with them",
  },
  {
    table: "known_insurers",
    columns: ["name", "address", "postcode", "telephone", "email"],
    about: ["business contact"],
    why: "Insurer contact details offered when a claim is set up",
    roles: OFFICE,
    retention: "While CAS works with them",
  },
  {
    table: "known_agents",
    columns: ["name", "address", "postcode", "telephone", "email", "handler_name", "handler_email", "handler_tel"],
    about: ["business contact"],
    why: "Agent contact details offered when a claim is set up",
    roles: OFFICE,
    retention: "While CAS works with them",
  },
  {
    table: "breaches",
    columns: ["what_happened", "whose_data", "actions", "decision_reason"],
    about: ["client", "staff"],
    why: "The breach log",
    roles: "Justin",
    retention: "6 years (awaiting adviser)",
  },
  {
    table: "deletion_log",
    columns: ["file_reference", "what", "reason"],
    about: ["client"],
    why: "What kind of record was deleted, when and by whom (never the deleted data)",
    roles: "Justin",
    retention: "Audit log: 6 years (awaiting adviser)",
  },
];

/** Columns whose names look personal but hold none (checked by a test, so nothing is missed by accident). */
export const NOT_PERSONAL: Record<string, string[]> = {
  agreements: ["signature_status"],
  client_form_links: ["token_sha256"],
  esign_requests: ["token_sha256", "witness_staff_id"],
  fleet_vehicles: ["location", "notes"],
  recovery_jobs: ["location"],
  litigation: ["court_name"],
  login_challenges: ["pending_secret"],
  known_insurers: ["name_key"],
  known_agents: ["name_key"],
  vehicle_compliance_checks: ["registration", "details_match", "notes"],
  vehicles: ["body_type", "details_match_client"],
  fleet_gta_rules: ["name"],
};

export const PERSONAL_NAME_PATTERN =
  /(name|email|_tel$|telephone|phone|mobile|address|postcode|dob|birth|licence|license|signature|signer|^ip$|device|ni_number|bank|sort_code|iban|points|endorse|conviction|circumstances|location|password|totp|secret|registration|town|witness)/i;

export const STORAGE_WORDS =
  "The SQLite database on this PC (%LOCALAPPDATA%\\CAS-CRM\\cas-crm.sqlite), not OneDrive; uploaded and produced files under %LOCALAPPDATA%\\CAS-CRM\\files; copies in any backup folder made with npm run backup.";
