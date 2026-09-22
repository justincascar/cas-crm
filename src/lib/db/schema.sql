-- CAS CRM schema. SQLite. Dates stored as ISO-8601 text in UTC; display in Europe/London.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  full_name TEXT NOT NULL,
  title TEXT,
  forename TEXT,
  surname TEXT,
  date_of_birth TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  town TEXT,
  postcode TEXT,
  telephone TEXT,
  email TEXT,
  preferred_channel TEXT,
  licence_number TEXT,
  home_tel TEXT,
  work_tel TEXT,
  mobile_tel TEXT,
  licence_issued_on TEXT,
  licence_expires_on TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  usage TEXT NOT NULL,
  registration TEXT,
  make TEXT,
  model TEXT,
  transmission TEXT,
  fuel TEXT,
  body_type TEXT,
  seats INTEGER,
  colour TEXT,
  specs_json TEXT,
  lookup_source TEXT,
  lookup_incomplete INTEGER NOT NULL DEFAULT 0,
  provenance TEXT,
  engine_cc INTEGER,
  first_registered_on TEXT,
  vehicle_class TEXT,
  v5c_missing_json TEXT,
  tax_status TEXT,
  mot_status TEXT,
  insurance_recorded TEXT,
  details_match_client INTEGER,
  gta_group TEXT
);

CREATE TABLE IF NOT EXISTS engineers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  email TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fleet_vehicles (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  status TEXT NOT NULL,
  location TEXT,
  notes TEXT,
  is_real INTEGER NOT NULL DEFAULT 0,
  removed_at TEXT,
  removed_reason TEXT,
  v5c_source_file TEXT
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  file_reference TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  accident_at TEXT,
  accident_location TEXT,
  circumstances TEXT,
  claim_type TEXT NOT NULL,
  cas_liability_assessment TEXT,
  insurer_liability_position TEXT,
  roadworthiness TEXT,
  roadworthiness_assessor TEXT,
  roadworthiness_assessed_at TEXT,
  roadworthiness_reasons TEXT,
  current_position TEXT NOT NULL,
  handler_id TEXT REFERENCES staff(id),
  engineer_id TEXT REFERENCES engineers(id),
  last_correspondence_at TEXT,
  next_action TEXT,
  next_action_due TEXT,
  client_person_id TEXT REFERENCES people(id),
  client_vehicle_id TEXT REFERENCES vehicles(id),
  hire_agreement_number TEXT,
  own_insurer_name TEXT,
  own_policy_ref TEXT,
  own_claim_ref TEXT,
  own_insurer_address TEXT,
  own_insurer_postcode TEXT,
  own_excess_pence INTEGER,
  audatex_network_code TEXT,
  audatex_work_provider_code TEXT,
  incomplete_client_submission INTEGER NOT NULL DEFAULT 0,
  is_new_enquiry INTEGER NOT NULL DEFAULT 0,
  repair_status TEXT,
  engineering_status TEXT,
  hire_status TEXT,
  recovery_status TEXT,
  storage_status TEXT,
  salvage_status TEXT,
  total_loss INTEGER NOT NULL DEFAULT 0,
  payment_qualifies_off_hire INTEGER NOT NULL DEFAULT 0,
  off_hire_scheduled_on TEXT,
  storage_billing_end_on TEXT,
  repairs_complete INTEGER NOT NULL DEFAULT 0,
  repaired_vehicle_returned INTEGER NOT NULL DEFAULT 0,
  client_form_status TEXT,
  later_declared_total_loss INTEGER NOT NULL DEFAULT 0,
  replacement_need_review INTEGER NOT NULL DEFAULT 0,
  client_role TEXT,
  damage_description TEXT,
  police_attended TEXT,
  police_ref TEXT,
  police_details TEXT,
  weather_conditions TEXT,
  journey_purpose TEXT,
  client_speed TEXT,
  tp_speed TEXT,
  needs_recovery INTEGER NOT NULL DEFAULT 0,
  photos_whatsapp_status TEXT,
  photos_at_scene TEXT,
  other_contact_skipped INTEGER NOT NULL DEFAULT 0,
  storage_started_on TEXT,
  storage_rate_pence INTEGER
);

CREATE TABLE IF NOT EXISTS claim_parties (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id),
  role TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS claim_third_parties (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id),
  vehicle_id TEXT REFERENCES vehicles(id),
  insurer_name TEXT,
  insurer_ref TEXT,
  representative TEXT,
  nomination_date TEXT,
  sequence INTEGER NOT NULL DEFAULT 1,
  insurer_address TEXT,
  insurer_postcode TEXT,
  insurer_tel TEXT,
  insurer_email TEXT,
  policy_number TEXT,
  handler_name TEXT,
  handler_email TEXT,
  handler_tel TEXT,
  agent_name TEXT,
  agent_address TEXT,
  agent_postcode TEXT,
  agent_tel TEXT,
  agent_email TEXT,
  agent_ref TEXT,
  agent_handler_name TEXT,
  agent_handler_email TEXT,
  agent_handler_tel TEXT,
  liability_admitted TEXT
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES staff(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  claim_id TEXT REFERENCES claims(id) ON DELETE SET NULL,
  handler_id TEXT REFERENCES staff(id),
  title TEXT NOT NULL,
  details TEXT,
  type TEXT NOT NULL,
  due_at TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  fleet_vehicle_id TEXT NOT NULL REFERENCES fleet_vehicles(id),
  claim_id TEXT REFERENCES claims(id),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  charges_started INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hire_episodes (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  fleet_vehicle_id TEXT REFERENCES fleet_vehicles(id),
  started_at TEXT,
  billing_end_at TEXT,
  collection_at TEXT,
  like_for_like INTEGER NOT NULL DEFAULT 0,
  suitability_reason TEXT,
  credit_hire INTEGER NOT NULL DEFAULT 0,
  rate_pence_per_day INTEGER,
  exception_reason TEXT
);

CREATE TABLE IF NOT EXISTS agreements (
  id TEXT PRIMARY KEY,
  hire_episode_id TEXT NOT NULL REFERENCES hire_episodes(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  start_on TEXT NOT NULL,
  planned_end_on TEXT NOT NULL,
  max_days INTEGER NOT NULL DEFAULT 88,
  renewal_alert_day INTEGER NOT NULL DEFAULT 80,
  signed INTEGER NOT NULL DEFAULT 0,
  signed_at TEXT,
  signature_status TEXT NOT NULL,
  template_note TEXT
);

CREATE TABLE IF NOT EXISTS handovers (
  id TEXT PRIMARY KEY,
  hire_episode_id TEXT NOT NULL REFERENCES hire_episodes(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  mileage INTEGER,
  fuel_level TEXT,
  condition_notes TEXT,
  signed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vehicle_handovers (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  hire_episode_id TEXT REFERENCES hire_episodes(id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL REFERENCES staff(id),
  mileage INTEGER NOT NULL,
  fuel_level TEXT NOT NULL,
  spare_wheel TEXT NOT NULL,
  tools_present TEXT NOT NULL,
  warning_lights_off TEXT NOT NULL,
  tyres_legal TEXT NOT NULL,
  condition_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vehicle_handovers_claim ON vehicle_handovers(claim_id, occurred_at);

CREATE TABLE IF NOT EXISTS vehicle_handover_photos (
  id TEXT PRIMARY KEY,
  handover_id TEXT NOT NULL REFERENCES vehicle_handovers(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id),
  slot TEXT NOT NULL DEFAULT 'damage',
  taken_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vehicle_handover_photos ON vehicle_handover_photos(handover_id);

CREATE TABLE IF NOT EXISTS vehicle_handover_scans (
  id TEXT PRIMARY KEY,
  handover_id TEXT NOT NULL REFERENCES vehicle_handovers(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id),
  attached_at TEXT NOT NULL,
  UNIQUE (handover_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_handover_scans ON vehicle_handover_scans(handover_id);

CREATE TABLE IF NOT EXISTS day_assignments (
  id TEXT PRIMARY KEY,
  assignee_id TEXT NOT NULL REFERENCES staff(id),
  job_kind TEXT NOT NULL,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  hire_episode_id TEXT REFERENCES hire_episodes(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  created_by TEXT REFERENCES staff(id),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_day_assignments_person ON day_assignments(assignee_id, work_date);

CREATE TABLE IF NOT EXISTS repair_evidence (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id),
  note TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL REFERENCES staff(id),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_repair_evidence_claim ON repair_evidence(claim_id, created_at);

CREATE TABLE IF NOT EXISTS financial_lines (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  head_of_loss TEXT NOT NULL,
  description TEXT,
  quantity REAL,
  unit TEXT,
  rate_pence INTEGER,
  net_pence INTEGER NOT NULL DEFAULT 0,
  vat_pence INTEGER NOT NULL DEFAULT 0,
  gross_pence INTEGER NOT NULL DEFAULT 0,
  claimed_pence INTEGER NOT NULL DEFAULT 0,
  offered_pence INTEGER NOT NULL DEFAULT 0,
  agreed_pence INTEGER NOT NULL DEFAULT 0,
  received_pence INTEGER NOT NULL DEFAULT 0,
  offer_status TEXT
);

CREATE TABLE IF NOT EXISTS correspondence (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  channel TEXT NOT NULL,
  subject TEXT,
  preview TEXT,
  body TEXT,
  to_address TEXT,
  from_address TEXT,
  unread INTEGER NOT NULL DEFAULT 0,
  sent_status TEXT,
  template_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  claim_id TEXT REFERENCES claims(id) ON DELETE CASCADE,
  vehicle_id TEXT REFERENCES vehicles(id),
  fleet_vehicle_id TEXT REFERENCES fleet_vehicles(id),
  title TEXT NOT NULL,
  kind TEXT,
  document_type TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  signed INTEGER NOT NULL DEFAULT 0,
  simulated INTEGER NOT NULL DEFAULT 1,
  body_html TEXT,
  template_key TEXT,
  missing_json TEXT,
  original_filename TEXT,
  stored_relpath TEXT,
  mime_type TEXT,
  byte_size INTEGER,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claim_events (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  details TEXT,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  actor_id TEXT,
  channel TEXT,
  document_id TEXT,
  correspondence_id TEXT,
  source TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY,
  claim_id TEXT REFERENCES claims(id) ON DELETE CASCADE,
  rule_key TEXT NOT NULL,
  track TEXT NOT NULL,
  next_run_at TEXT,
  interval_days INTEGER NOT NULL DEFAULT 3,
  interval_unit TEXT NOT NULL DEFAULT 'calendar_days',
  interval_override_days INTEGER,
  interval_override_reason TEXT,
  paused INTEGER NOT NULL DEFAULT 0,
  last_outcome TEXT,
  reason TEXT,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS litigation (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  deadline_on TEXT,
  deadline_source TEXT,
  deadline_trigger TEXT,
  reviewer TEXT,
  approved_to_issue INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mid_lookups (
  id TEXT PRIMARY KEY,
  claim_id TEXT REFERENCES claims(id),
  registration TEXT NOT NULL,
  accident_on TEXT,
  lookup_on TEXT NOT NULL,
  insurer TEXT,
  checker_id TEXT REFERENCES staff(id),
  evidence TEXT,
  source TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claim_witnesses (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  full_name TEXT,
  telephone TEXT,
  postcode TEXT,
  address_line1 TEXT,
  town TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recovery_jobs (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  location TEXT,
  recovered_at TEXT,
  charge_pence INTEGER NOT NULL DEFAULT 0,
  winch_pence INTEGER NOT NULL DEFAULT 0,
  ooh_pence INTEGER NOT NULL DEFAULT 0,
  environmental_pence INTEGER NOT NULL DEFAULT 0,
  forklift_pence INTEGER NOT NULL DEFAULT 0,
  mileage_pence INTEGER NOT NULL DEFAULT 0,
  manual_pence INTEGER NOT NULL DEFAULT 0,
  inherited INTEGER NOT NULL DEFAULT 0,
  inherited_note TEXT,
  receipt_document_id TEXT,
  driver_whatsapp_status TEXT,
  client_whatsapp_status TEXT,
  agreement_status TEXT,
  agreement_channel TEXT,
  agreement_document_id TEXT,
  storage_started_on TEXT,
  storage_rate_pence INTEGER
);

CREATE TABLE IF NOT EXISTS vehicle_compliance_checks (
  id TEXT PRIMARY KEY,
  claim_id TEXT REFERENCES claims(id),
  vehicle_id TEXT REFERENCES vehicles(id),
  registration TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  tax_status TEXT,
  mot_status TEXT,
  insurance_status TEXT,
  details_match TEXT,
  source TEXT NOT NULL,
  notes TEXT,
  checker_id TEXT REFERENCES staff(id)
);

CREATE TABLE IF NOT EXISTS claim_screen_data (
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  screen_key TEXT NOT NULL,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (claim_id, screen_key)
);

CREATE TABLE IF NOT EXISTS known_insurers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  address TEXT,
  postcode TEXT,
  telephone TEXT,
  email TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS known_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  address TEXT,
  postcode TEXT,
  telephone TEXT,
  email TEXT,
  handler_name TEXT,
  handler_email TEXT,
  handler_tel TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_claims_handler ON claims(handler_id);
CREATE INDEX IF NOT EXISTS idx_sessions_staff ON sessions(staff_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_claims_ref ON claims(file_reference);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at, status);
CREATE INDEX IF NOT EXISTS idx_reservations_vehicle ON reservations(fleet_vehicle_id, status);
CREATE INDEX IF NOT EXISTS idx_parties_claim ON claim_parties(claim_id);
CREATE INDEX IF NOT EXISTS idx_notes_claim ON notes(claim_id);
CREATE INDEX IF NOT EXISTS idx_financial_claim ON financial_lines(claim_id);
CREATE INDEX IF NOT EXISTS idx_events_claim ON claim_events(claim_id, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_automations_claim_rule ON automations(claim_id, rule_key);
