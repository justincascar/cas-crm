import type { DatabaseSync } from "node:sqlite";

const TABLES: Record<string, Array<[string, string]>> = {
  correspondence: [
    ["body", "TEXT"],
    ["to_address", "TEXT"],
    ["from_address", "TEXT"],
    ["template_key", "TEXT"],
  ],
  documents: [
    ["body_html", "TEXT"],
    ["template_key", "TEXT"],
    ["missing_json", "TEXT"],
  ],
  people: [
    ["title", "TEXT"],
    ["forename", "TEXT"],
    ["surname", "TEXT"],
    ["home_tel", "TEXT"],
    ["work_tel", "TEXT"],
    ["mobile_tel", "TEXT"],
    ["licence_issued_on", "TEXT"],
    ["licence_expires_on", "TEXT"],
  ],
  vehicles: [
    ["tax_status", "TEXT"],
    ["mot_status", "TEXT"],
    ["insurance_recorded", "TEXT"],
    ["details_match_client", "INTEGER"],
  ],
  claims: [
    ["client_role", "TEXT"],
    ["damage_description", "TEXT"],
    ["police_attended", "TEXT"],
    ["police_ref", "TEXT"],
    ["police_details", "TEXT"],
    ["weather_conditions", "TEXT"],
    ["journey_purpose", "TEXT"],
    ["client_speed", "TEXT"],
    ["tp_speed", "TEXT"],
    ["needs_recovery", "INTEGER NOT NULL DEFAULT 0"],
    ["photos_whatsapp_status", "TEXT"],
    ["photos_at_scene", "TEXT"],
    ["other_contact_skipped", "INTEGER NOT NULL DEFAULT 0"],
    ["storage_started_on", "TEXT"],
    ["storage_rate_pence", "INTEGER"],
    ["own_insurer_address", "TEXT"],
    ["own_insurer_postcode", "TEXT"],
    ["audatex_network_code", "TEXT"],
    ["audatex_work_provider_code", "TEXT"],
    ["engineer_id", "TEXT"],
  ],
  claim_third_parties: [
    ["sequence", "INTEGER NOT NULL DEFAULT 1"],
    ["insurer_address", "TEXT"],
    ["insurer_postcode", "TEXT"],
    ["insurer_tel", "TEXT"],
    ["insurer_email", "TEXT"],
    ["policy_number", "TEXT"],
    ["handler_name", "TEXT"],
    ["handler_email", "TEXT"],
    ["handler_tel", "TEXT"],
    ["agent_name", "TEXT"],
    ["agent_address", "TEXT"],
    ["agent_postcode", "TEXT"],
    ["agent_tel", "TEXT"],
    ["agent_email", "TEXT"],
    ["agent_ref", "TEXT"],
    ["agent_handler_name", "TEXT"],
    ["agent_handler_email", "TEXT"],
    ["agent_handler_tel", "TEXT"],
    ["liability_admitted", "TEXT"],
  ],
  automations: [
    ["interval_override_days", "INTEGER"],
    ["interval_override_reason", "TEXT"],
  ],
  hire_pack_data: [
    ["means_documents_requested", "INTEGER"],
    ["means_documents_on_file", "INTEGER"],
    ["cannot_fund_hire", "INTEGER"],
    ["no_other_credit", "INTEGER"],
    ["means_notes", "TEXT"],
    ["own_vehicle_mileage", "INTEGER"],
    ["own_vehicle_fuel", "TEXT"],
    ["own_vehicle_tyres", "TEXT"],
    ["own_vehicle_damage", "TEXT"],
  ],
};

export function migrate(db: DatabaseSync) {
  db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_events_claim ON claim_events(claim_id, occurred_at);
    CREATE TABLE IF NOT EXISTS hire_pack_data (
      claim_id TEXT PRIMARY KEY,
      title TEXT,
      home_tel TEXT,
      work_tel TEXT,
      mobile_tel TEXT,
      licence_issued_on TEXT,
      licence_expires_on TEXT,
      additional_name TEXT,
      additional_address TEXT,
      additional_dob TEXT,
      additional_licence TEXT,
      additional_licence_issued_on TEXT,
      additional_licence_expires_on TEXT,
      delivery_address TEXT,
      hire_fuel TEXT,
      vehicle_group TEXT,
      group_charged TEXT,
      date_out TEXT,
      date_in TEXT,
      daily_rate_pence INTEGER,
      sat_nav_pence INTEGER,
      additional_driver_pence INTEGER,
      hands_free_pence INTEGER,
      cdw_pence INTEGER,
      child_seat_pence INTEGER,
      automatic_pence INTEGER,
      insurance_daily_pence INTEGER,
      estate_pence INTEGER,
      insurance_pence INTEGER,
      tow_bar_pence INTEGER,
      admin_pence INTEGER,
      roof_rack_pence INTEGER,
      delivery_collection_pence INTEGER,
      no_replacement_offer INTEGER,
      declined_offer_reason TEXT,
      understands_personal_liability INTEGER,
      need_reason TEXT,
      own_vehicle_unusable INTEGER,
      no_other_vehicle INTEGER,
      delivery_mileage INTEGER,
      delivery_fuel TEXT,
      delivery_tyres TEXT,
      delivery_damage TEXT,
      delivery_interior TEXT,
      collection_mileage INTEGER,
      collection_fuel TEXT,
      collection_damage TEXT,
      storage_daily_pence INTEGER,
      recovery_pence INTEGER,
      driver_delivery_start TEXT,
      driver_delivery_finish TEXT,
      driver_name TEXT,
      means_documents_requested INTEGER,
      means_documents_on_file INTEGER,
      cannot_fund_hire INTEGER,
      no_other_credit INTEGER,
      means_notes TEXT,
      own_vehicle_mileage INTEGER,
      own_vehicle_fuel TEXT,
      own_vehicle_tyres TEXT,
      own_vehicle_damage TEXT,
      updated_at TEXT
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
    CREATE TABLE IF NOT EXISTS claim_screen_data (
      claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      screen_key TEXT NOT NULL,
      data_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (claim_id, screen_key)
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
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_staff ON sessions(staff_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_automations_claim_rule ON automations(claim_id, rule_key);
  `);

  for (const [table, columns] of Object.entries(TABLES)) {
    const existing = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    const names = new Set(existing.map((c) => c.name));
    for (const [column, type] of columns) {
      if (!names.has(column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      }
    }
  }
}
