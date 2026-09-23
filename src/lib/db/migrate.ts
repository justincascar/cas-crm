import type { DatabaseSync } from "node:sqlite";

const TABLES: Record<string, Array<[string, string]>> = {
  correspondence: [
    ["body", "TEXT"],
    ["to_address", "TEXT"],
    ["from_address", "TEXT"],
    ["template_key", "TEXT"],
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
    ["engine_cc", "INTEGER"],
    ["first_registered_on", "TEXT"],
    ["vehicle_class", "TEXT"],
    ["v5c_missing_json", "TEXT"],
    ["gta_group", "TEXT"],
  ],
  fleet_vehicles: [
    ["is_real", "INTEGER NOT NULL DEFAULT 0"],
    ["removed_at", "TEXT"],
    ["removed_reason", "TEXT"],
    ["v5c_source_file", "TEXT"],
  ],
  documents: [
    ["body_html", "TEXT"],
    ["template_key", "TEXT"],
    ["missing_json", "TEXT"],
    ["vehicle_id", "TEXT"],
    ["fleet_vehicle_id", "TEXT"],
    ["document_type", "TEXT"],
    ["original_filename", "TEXT"],
    ["stored_relpath", "TEXT"],
    ["mime_type", "TEXT"],
    ["byte_size", "INTEGER"],
    ["created_by", "TEXT"],
  ],
  hire_episodes: [["hire_end_review_on", "TEXT"]],
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
    ["storage_date_review_on", "TEXT"],
    ["storage_end_review_on", "TEXT"],
    ["own_insurer_address", "TEXT"],
    ["own_insurer_postcode", "TEXT"],
    ["audatex_network_code", "TEXT"],
    ["audatex_work_provider_code", "TEXT"],
    ["engineer_id", "TEXT"],
    ["hire_agreement_number", "TEXT"],
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
    ["group_override_reason", "TEXT"],
    ["daily_rate_manual", "INTEGER"],
  ],
};

function tableColumns(db: DatabaseSync, table: string): Array<{ name: string; notnull: number }> {
  return db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number }>;
}

function rebuildDocumentsTable(db: DatabaseSync) {
  const cols = tableColumns(db, "documents");
  if (!cols.length) return;
  const claim = cols.find((c) => c.name === "claim_id");
  const required = [
    "vehicle_id",
    "fleet_vehicle_id",
    "document_type",
    "original_filename",
    "stored_relpath",
    "mime_type",
    "byte_size",
    "created_by",
  ];
  const hasRequired = required.every((name) => cols.some((c) => c.name === name));
  if (claim && claim.notnull === 0 && hasRequired) return;

  const existingNames = new Set(cols.map((c) => c.name));
  const copy = [
    "id",
    "claim_id",
    "title",
    "kind",
    "version",
    "signed",
    "simulated",
    "body_html",
    "template_key",
    "missing_json",
    "created_at",
    "vehicle_id",
    "fleet_vehicle_id",
    "document_type",
    "original_filename",
    "stored_relpath",
    "mime_type",
    "byte_size",
    "created_by",
  ].filter((name) => existingNames.has(name));

  db.exec("PRAGMA foreign_keys = OFF");
  db.exec(`
    CREATE TABLE documents_migrated (
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
  `);
  db.exec(`INSERT INTO documents_migrated (${copy.join(", ")}) SELECT ${copy.join(", ")} FROM documents`);
  db.exec("DROP TABLE documents");
  db.exec("ALTER TABLE documents_migrated RENAME TO documents");
  db.exec("PRAGMA foreign_keys = ON");
}

export function migrate(db: DatabaseSync) {
  rebuildDocumentsTable(db);
  db.exec(`
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
      created_at TEXT NOT NULL,
      finished_at TEXT,
      actual_driver_id TEXT,
      shot_set TEXT NOT NULL DEFAULT 'five'
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
  `);
  const handoverColumns = db.prepare(`PRAGMA table_info(vehicle_handovers)`).all() as Array<{ name: string }>;
  if (handoverColumns.length > 0 && !handoverColumns.some((column) => column.name === "finished_at")) {
    db.exec(`ALTER TABLE vehicle_handovers ADD COLUMN finished_at TEXT`);
  }
  if (handoverColumns.length > 0 && !handoverColumns.some((column) => column.name === "actual_driver_id")) {
    db.exec(`ALTER TABLE vehicle_handovers ADD COLUMN actual_driver_id TEXT`);
  }
  if (handoverColumns.length > 0 && !handoverColumns.some((column) => column.name === "shot_set")) {
    db.exec(`ALTER TABLE vehicle_handovers ADD COLUMN shot_set TEXT NOT NULL DEFAULT 'five'`);
  }
  const photoColumns = db.prepare(`PRAGMA table_info(vehicle_handover_photos)`).all() as Array<{ name: string }>;
  if (photoColumns.length > 0 && !photoColumns.some((column) => column.name === "slot")) {
    db.exec(`ALTER TABLE vehicle_handover_photos ADD COLUMN slot TEXT NOT NULL DEFAULT 'damage'`);
  }
  db.exec(`
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
      created_at TEXT NOT NULL,
      completed_at TEXT,
      actual_driver_id TEXT,
      actual_occurred_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_day_assignments_person ON day_assignments(assignee_id, work_date);
  `);
  const assignmentColumns = db.prepare(`PRAGMA table_info(day_assignments)`).all() as Array<{ name: string }>;
  for (const column of ["completed_at", "actual_driver_id", "actual_occurred_at"]) {
    if (assignmentColumns.length > 0 && !assignmentColumns.some((existing) => existing.name === column)) {
      db.exec(`ALTER TABLE day_assignments ADD COLUMN ${column} TEXT`);
    }
  }
  db.exec(`
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
  `);
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

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_documents_claim ON documents(claim_id);
    CREATE INDEX IF NOT EXISTS idx_documents_fleet ON documents(fleet_vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(document_type);
    CREATE INDEX IF NOT EXISTS idx_fleet_real ON fleet_vehicles(is_real, removed_at);
    INSERT INTO settings(key, value)
      SELECT 'gta_markup_percent', '30'
      WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'gta_markup_percent');
    INSERT INTO settings(key, value)
      SELECT 'next_hire_agreement_number', '1'
      WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'next_hire_agreement_number');
  `);
}
