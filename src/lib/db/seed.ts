import type { DatabaseSync } from "node:sqlite";
import { FILE_REFERENCE_PREFIX_DEFAULT } from "../constants";
import { isoDateFromNow, isoDaysFromNow, nowUtcIso } from "../dates";
import { pence, vatOnNet } from "../money";

function run(db: DatabaseSync, sql: string, params: unknown[] = []) {
  db.prepare(sql).run(...params);
}

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
  return Number(row.c);
}

export function seedIfEmpty(db: DatabaseSync) {
  if (count(db, "claims") > 0) return;
  seed(db);
}

export function seed(db: DatabaseSync) {
  const now = nowUtcIso();

  run(db, "INSERT INTO settings(key, value) VALUES (?, ?)", ["file_prefix", FILE_REFERENCE_PREFIX_DEFAULT]);
  run(db, "INSERT INTO settings(key, value) VALUES (?, ?)", ["environment", "prototype"]);
  run(db, "INSERT INTO settings(key, value) VALUES (?, ?)", ["agreement_max_days", "88"]);
  run(db, "INSERT INTO settings(key, value) VALUES (?, ?)", ["agreement_renewal_alert_day", "80"]);
  run(db, "INSERT INTO settings(key, value) VALUES (?, ?)", ["chaser_interval_days", "3"]);
  run(db, "INSERT INTO settings(key, value) VALUES (?, ?)", ["chaser_interval_unit", "calendar_days"]);

  const staff = [
    ["staff-justin", "Justin Roberts", "justin@completeaccidentsolutions.example", "md"],
    ["staff-sian", "Sian Evans", "sian.evans@completeaccidentsolutions.example", "handler"],
    ["staff-tom", "Tom Hughes", "tom.hughes@completeaccidentsolutions.example", "handler"],
    ["staff-megan", "Megan Price", "megan.price@completeaccidentsolutions.example", "handler"],
  ];
  for (const [id, name, email, role] of staff) {
    run(db, "INSERT INTO staff(id, name, email, role, active) VALUES (?, ?, ?, ?, 1)", [id, name, email, role]);
  }

  const people: Array<Record<string, string | null>> = [
    { id: "p-aled", kind: "individual", name: "Aled Morgan", dob: "1988-04-12", a1: "14 Splott Road", town: "Cardiff", pc: "CF24 2DA", tel: "029 2000 1001", email: "aled.morgan@example.test", ch: "phone" },
    { id: "p-bethan", kind: "individual", name: "Bethan Lewis", dob: "1992-11-03", a1: "8 Windsor Terrace", town: "Penarth", pc: "CF64 1AA", tel: "029 2000 1002", email: "bethan.lewis@example.test", ch: "email" },
    { id: "p-ceri", kind: "individual", name: "Ceri Walsh", dob: "1979-01-22", a1: "21 Uplands Crescent", town: "Swansea", pc: "SA2 0NX", tel: "01792 000003", email: "ceri.walsh@example.test", ch: "whatsapp" },
    { id: "p-daf", kind: "individual", name: "Dafydd Jones", dob: "1985-07-19", a1: "3 Nolton Street", town: "Bridgend", pc: "CF31 1BX", tel: "01656 000004", email: "dafydd.jones@example.test", ch: "phone" },
    { id: "p-elin", kind: "individual", name: "Elin Powell", dob: "1996-02-08", a1: "44 Caerleon Road", town: "Newport", pc: "NP19 7BX", tel: "01633 000005", email: "elin.powell@example.test", ch: "email" },
    { id: "p-ffion", kind: "individual", name: "Ffion Rees", dob: "1974-09-30", a1: "10 Taff Street", town: "Pontypridd", pc: "CF37 4UA", tel: "01443 000006", email: "ffion.rees@example.test", ch: "letter" },
    { id: "p-gareth", kind: "individual", name: "Gareth Bevan", dob: "1968-06-14", a1: "5 High Street", town: "Merthyr Tydfil", pc: "CF47 8DN", tel: "01685 000007", email: "gareth.bevan@example.test", ch: "phone" },
    { id: "p-haf", kind: "individual", name: "Haf Davies", dob: "1990-12-01", a1: "18 Holton Road", town: "Barry", pc: "CF63 4HD", tel: "01446 000008", email: "haf.davies@example.test", ch: "email" },
    { id: "p-ioan", kind: "individual", name: "Ioan Price", dob: "1982-03-25", a1: "2 The Mall", town: "Cwmbran", pc: "NP44 1PX", tel: "01633 000009", email: "ioan.price@example.test", ch: "phone" },
    { id: "p-jess", kind: "business", name: "Chen Logistics Ltd", dob: null, a1: "Unit 4, Ocean Way", town: "Cardiff", pc: "CF24 5HF", tel: "029 2000 1010", email: "claims@chenlogistics.example.test", ch: "email" },
    { id: "p-kieran", kind: "individual", name: "Kieran O'Neil", dob: "1994-08-17", a1: "27 Cardiff Road", town: "Caerphilly", pc: "CF83 1FP", tel: "029 2000 1011", email: "kieran.oneil@example.test", ch: "sms" },
    { id: "p-lowri", kind: "individual", name: "Lowri Hughes", dob: "1987-05-05", a1: "9 Cathedral Road", town: "Cardiff", pc: "CF11 9HA", tel: "029 2000 1012", email: "lowri.hughes@example.test", ch: "email" },
    { id: "p-tp1", kind: "individual", name: "Mark Stevens", dob: null, a1: "Unknown", town: "Newport", pc: "Unknown", tel: "Unknown", email: null, ch: null },
    { id: "p-tp2", kind: "individual", name: "Priya Shah", dob: null, a1: "12 Cowbridge Road", town: "Cardiff", pc: "CF5 1AA", tel: "029 2000 2002", email: "priya.shah@example.test", ch: "email" },
    { id: "p-tp3", kind: "individual", name: "Owen Griffiths", dob: null, a1: "Unknown", town: "Swansea", pc: "Unknown", tel: "Unknown", email: null, ch: null },
    { id: "p-wit1", kind: "individual", name: "Nia Jenkins", dob: null, a1: "Bus stop, Newport Road", town: "Cardiff", pc: "CF24 0AD", tel: "029 2000 3003", email: null, ch: "phone" },
    { id: "p-jess-driver", kind: "individual", name: "Mei Chen", dob: "1991-10-10", a1: "Unit 4, Ocean Way", town: "Cardiff", pc: "CF24 5HF", tel: "029 2000 1013", email: "mei.chen@chenlogistics.example.test", ch: "phone" },
  ];

  for (const p of people) {
    run(
      db,
      `INSERT INTO people(id, kind, full_name, date_of_birth, address_line1, town, postcode, telephone, email, preferred_channel, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.id, p.kind, p.name, p.dob, p.a1, p.town, p.pc, p.tel, p.email, p.ch, now],
    );
  }

  const vehicles = [
    ["v-aled", "client", "CF71 ABC", "Ford", "Focus", "manual", "petrol", "hatchback", 5, "blue", "manual", 0, "client"],
    ["v-bethan", "client", "CF64 DLE", "BMW", "320i", "automatic", "petrol", "saloon", 5, "black", "manual", 0, "staff"],
    ["v-ceri", "client", "SA12 CWA", "Volkswagen", "Golf", "automatic", "diesel", "hatchback", 5, "white", "simulated", 1, "lookup"],
    ["v-daf", "client", "CF31 DJO", "Vauxhall", "Astra", "manual", "petrol", "hatchback", 5, "red", "manual", 0, "staff"],
    ["v-elin", "client", "NP19 ELP", "Audi", "A3", "automatic", "petrol", "hatchback", 5, "grey", "simulated", 0, "lookup"],
    ["v-ffion", "client", "CF37 FRE", "Nissan", "Qashqai", "manual", "diesel", "suv", 5, "green", "manual", 0, "staff"],
    ["v-gareth", "client", "CF47 GBE", "Skoda", "Octavia", "automatic", "diesel", "estate", 5, "silver", "manual", 0, "staff"],
    ["v-haf", "client", "CF63 HDA", "Toyota", "Corolla", "automatic", "hybrid", "hatchback", 5, "white", "manual", 0, "staff"],
    ["v-ioan", "client", "NP44 IPR", "Mercedes-Benz", "C220", "automatic", "diesel", "saloon", 5, "black", "manual", 0, "staff"],
    ["v-jess", "client", "CF24 CHN", "Ford", "Transit", "manual", "diesel", "van", 3, "white", "manual", 0, "staff"],
    ["v-kieran", "client", "CF83 KON", "Kia", "Sportage", "automatic", "petrol", "suv", 5, "blue", "simulated", 0, "lookup"],
    ["v-lowri", "client", "CF11 LHU", "Volvo", "XC60", "automatic", "hybrid", "suv", 5, "grey", "manual", 0, "staff"],
    ["v-tp-aled", "third_party", "Unknown", "Unknown", "Unknown", "unknown", "unknown", "unknown", null, "unknown", "manual", 1, "client"],
    ["v-tp-bethan", "third_party", "WN12 PSH", "Peugeot", "208", "manual", "petrol", "hatchback", 5, "white", "simulated", 1, "lookup"],
    ["v-fleet-1", "fleet", "CAS 1", "BMW", "320i", "automatic", "petrol", "saloon", 5, "black", "manual", 0, "staff"],
    ["v-fleet-2", "fleet", "CAS 2", "Volkswagen", "Golf", "automatic", "diesel", "hatchback", 5, "white", "manual", 0, "staff"],
    ["v-fleet-3", "fleet", "CAS 3", "Vauxhall", "Corsa", "manual", "petrol", "hatchback", 5, "blue", "manual", 0, "staff"],
    ["v-fleet-4", "fleet", "CAS 4", "Ford", "Focus", "manual", "petrol", "hatchback", 5, "grey", "manual", 0, "staff"],
    ["v-fleet-5", "fleet", "CAS 5", "Mercedes-Benz", "C220", "automatic", "diesel", "saloon", 5, "silver", "manual", 0, "staff"],
    ["v-fleet-6", "fleet", "CAS 6", "Ford", "Transit", "manual", "diesel", "van", 3, "white", "manual", 0, "staff"],
    ["v-fleet-7", "fleet", "CAS 7", "Toyota", "Prius", "automatic", "hybrid", "hatchback", 5, "white", "manual", 0, "staff"],
    ["v-fleet-8", "fleet", "CAS 8", "Kia", "Sportage", "automatic", "petrol", "suv", 7, "navy", "manual", 0, "staff"],
    ["v-fleet-9", "fleet", "CAS 9", "Skoda", "Octavia", "automatic", "diesel", "estate", 5, "silver", "manual", 0, "staff"],
    ["v-fleet-10", "fleet", "CAS 10", "Peugeot", "208", "manual", "petrol", "hatchback", 5, "red", "manual", 0, "staff"],
  ];

  for (const v of vehicles) {
    run(
      db,
      `INSERT INTO vehicles(id, usage, registration, make, model, transmission, fuel, body_type, seats, colour, lookup_source, lookup_incomplete, provenance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      v,
    );
  }

  const fleet = [
    ["fv-1", "v-fleet-1", "reserved", "CAS yard, Bridgend", "Reserved for TEST-0002 repair booking — charges not started"],
    ["fv-2", "v-fleet-2", "on_hire", "With customer", "Like-for-like auto Golf on TEST-0003"],
    ["fv-3", "v-fleet-3", "on_hire", "With customer", "Courtesy car on fault claim TEST-0004"],
    ["fv-4", "v-fleet-4", "available", "CAS yard, Bridgend", null],
    ["fv-5", "v-fleet-5", "on_hire", "With customer", "TEST-0009 total loss hire"],
    ["fv-6", "v-fleet-6", "maintenance", "Bodyshop", "Service — not available"],
    ["fv-7", "v-fleet-7", "on_hire", "With customer", "TEST-0007 repairs in progress"],
    ["fv-8", "v-fleet-8", "on_hire", "With customer", "TEST-0011 day-80 agreement"],
    ["fv-9", "v-fleet-9", "on_hire", "With customer", "TEST-0008 awaiting customer return"],
    ["fv-10", "v-fleet-10", "available", "CAS yard, Bridgend", null],
  ];
  for (const f of fleet) {
    run(db, "INSERT INTO fleet_vehicles(id, vehicle_id, status, location, notes) VALUES (?, ?, ?, ?, ?)", f);
  }

  type ClaimSeed = {
    id: string;
    ref: string;
    accidentDays: number;
    location: string;
    circumstances: string;
    claimType: string;
    casLiab: string;
    insLiab: string;
    rw: string;
    rwWho: string | null;
    rwWhenDays: number | null;
    rwWhy: string | null;
    position: string;
    handler: string;
    lastCorrDays: number | null;
    next: string;
    nextDueDays: number | null;
    client: string;
    vehicle: string;
    ownIns: string | null;
    ownPol: string | null;
    ownClm: string | null;
    incomplete: number;
    enquiry: number;
    repair: string;
    eng: string;
    hire: string;
    recovery: string;
    storage: string;
    salvage: string;
    tl: number;
    qualify: number;
    offHireDays: number | null;
    storageEndDays: number | null;
    repairsComplete: number;
    returned: number;
    form: string;
    laterTl: number;
    needReview: number;
  };

  const claims: ClaimSeed[] = [
    {
      id: "c1", ref: "TEST-0001", accidentDays: -1, location: "Newport Road, Cardiff",
      circumstances: "Client reports being struck from behind in slow traffic. Photographs and third-party details still outstanding.",
      claimType: "unknown", casLiab: "unknown", insLiab: "pending",
      rw: "awaiting_assessment", rwWho: null, rwWhenDays: null, rwWhy: null,
      position: "New enquiry — client form incomplete", handler: "staff-sian",
      lastCorrDays: 0, next: "Complete telephone capture of missing client details", nextDueDays: 0,
      client: "p-aled", vehicle: "v-aled", ownIns: "Unknown", ownPol: "Unknown", ownClm: "Unknown",
      incomplete: 1, enquiry: 1, repair: "not_applicable", eng: "not_instructed", hire: "none",
      recovery: "none", storage: "none", salvage: "none", tl: 0, qualify: 0, offHireDays: null, storageEndDays: null,
      repairsComplete: 0, returned: 0, form: "in_progress", laterTl: 0, needReview: 0,
    },
    {
      id: "c2", ref: "TEST-0002", accidentDays: -12, location: "Windsor Road, Penarth",
      circumstances: "Non-fault collision at a roundabout. Client vehicle remains roadworthy and with the client.",
      claimType: "non_fault", casLiab: "non_fault", insLiab: "pending",
      rw: "roadworthy", rwWho: "Sian Evans", rwWhenDays: -12, rwWhy: "Drivable, lights and steering intact, cosmetic nearside damage.",
      position: "Roadworthy — repairs to book; replacement reserved only", handler: "staff-sian",
      lastCorrDays: -2, next: "Book repair date and confirm reservation window", nextDueDays: 1,
      client: "p-bethan", vehicle: "v-bethan", ownIns: "Admiral", ownPol: "ADM-88421", ownClm: "Unknown",
      incomplete: 0, enquiry: 0, repair: "to_book", eng: "instructed", hire: "reserved",
      recovery: "none", storage: "none", salvage: "none", tl: 0, qualify: 0, offHireDays: null, storageEndDays: null,
      repairsComplete: 0, returned: 0, form: "reviewed", laterTl: 0, needReview: 0,
    },
    {
      id: "c3", ref: "TEST-0003", accidentDays: -6, location: "M4 Junction 42, Swansea",
      circumstances: "Undriveable after offside impact. Recovery completed the same evening. Like-for-like automatic Golf supplied.",
      claimType: "non_fault", casLiab: "non_fault", insLiab: "pending",
      rw: "unroadworthy", rwWho: "Tom Hughes", rwWhenDays: -6, rwWhy: "Airbag deployed, not safe to drive. Photographs on file.",
      position: "Undriveable — recovery done; like-for-like hire active; in storage", handler: "staff-tom",
      lastCorrDays: -1, next: "Chase liability response from third-party insurer", nextDueDays: 0,
      client: "p-ceri", vehicle: "v-ceri", ownIns: "Direct Line", ownPol: "DL-22019", ownClm: "DL-C-90331",
      incomplete: 0, enquiry: 0, repair: "awaiting_assessment", eng: "instructed", hire: "active",
      recovery: "complete", storage: "active", salvage: "none", tl: 0, qualify: 0, offHireDays: null, storageEndDays: null,
      repairsComplete: 0, returned: 0, form: "reviewed", laterTl: 0, needReview: 0,
    },
    {
      id: "c4", ref: "TEST-0004", accidentDays: -4, location: "A48, Bridgend",
      circumstances: "Fault claim. Client needs a courtesy car while repairs are arranged. Courtesy vehicle is not like-for-like and is not on credit-hire rates.",
      claimType: "fault", casLiab: "fault", insLiab: "admitted",
      rw: "roadworthy", rwWho: "Megan Price", rwWhenDays: -4, rwWhy: "Driveable with bumper damage. Client prefers not to use the vehicle.",
      position: "Fault — courtesy car allocated; no credit-hire charges", handler: "staff-megan",
      lastCorrDays: -1, next: "Confirm repair booking with client's own insurer", nextDueDays: 2,
      client: "p-daf", vehicle: "v-daf", ownIns: "Aviva", ownPol: "AV-10028", ownClm: "AV-CL-4410",
      incomplete: 0, enquiry: 0, repair: "to_book", eng: "not_instructed", hire: "active",
      recovery: "none", storage: "none", salvage: "none", tl: 0, qualify: 0, offHireDays: null, storageEndDays: null,
      repairsComplete: 0, returned: 0, form: "reviewed", laterTl: 0, needReview: 0,
    },
    {
      id: "c5", ref: "TEST-0005", accidentDays: -9, location: "Caerleon Road, Newport",
      circumstances: "Disputed junction collision. Engineer instructed in parallel with liability chase.",
      claimType: "non_fault", casLiab: "non_fault", insLiab: "pending",
      rw: "roadworthy", rwWho: "Sian Evans", rwWhenDays: -9, rwWhy: "Driveable; client using own vehicle pending inspection.",
      position: "Awaiting liability response and engineer report", handler: "staff-sian",
      lastCorrDays: -3, next: "Review engineer inspection outcome", nextDueDays: 1,
      client: "p-elin", vehicle: "v-elin", ownIns: "LV=", ownPol: "LV-77310", ownClm: "Unknown",
      incomplete: 0, enquiry: 0, repair: "not_applicable", eng: "awaiting_report", hire: "none",
      recovery: "none", storage: "none", salvage: "none", tl: 0, qualify: 0, offHireDays: null, storageEndDays: null,
      repairsComplete: 0, returned: 0, form: "reviewed", laterTl: 0, needReview: 0,
    },
    {
      id: "c6", ref: "TEST-0006", accidentDays: -18, location: "Taff Street, Pontypridd",
      circumstances: "Engineer report received and staff-verified. Repair authorisation requested from Ageas.",
      claimType: "non_fault", casLiab: "non_fault", insLiab: "partial",
      rw: "roadworthy", rwWho: "Independent engineer (verified)", rwWhenDays: -5, rwWhy: "Repairable; estimated £2,400 net. Staff accepted extraction after review.",
      position: "Engineer report in — awaiting repair authorisation", handler: "staff-tom",
      lastCorrDays: -3, next: "Chase Ageas repair authorisation / payment", nextDueDays: 0,
      client: "p-ffion", vehicle: "v-ffion", ownIns: "Ageas", ownPol: "AG-55201", ownClm: "AG-CL-8891",
      incomplete: 0, enquiry: 0, repair: "awaiting_auth", eng: "report_received", hire: "none",
      recovery: "none", storage: "none", salvage: "none", tl: 0, qualify: 0, offHireDays: null, storageEndDays: null,
      repairsComplete: 0, returned: 0, form: "reviewed", laterTl: 0, needReview: 0,
    },
    {
      id: "c7", ref: "TEST-0007", accidentDays: -21, location: "A470, Merthyr Tydfil",
      circumstances: "Repairable non-fault. Vehicle in the bodyshop. Replacement Prius on hire from actual handover.",
      claimType: "non_fault", casLiab: "non_fault", insLiab: "admitted",
      rw: "unroadworthy", rwWho: "Tom Hughes", rwWhenDays: -21, rwWhy: "Cooling leak and structural bumper; recovered to CAS.",
      position: "Repairs in progress", handler: "staff-tom",
      lastCorrDays: -1, next: "Parts chase — rear panel due", nextDueDays: 1,
      client: "p-gareth", vehicle: "v-gareth", ownIns: "Zurich", ownPol: "ZU-19002", ownClm: "ZU-CL-2201",
      incomplete: 0, enquiry: 0, repair: "in_progress", eng: "report_received", hire: "active",
      recovery: "complete", storage: "ended", salvage: "none", tl: 0, qualify: 0, offHireDays: null, storageEndDays: -14,
      repairsComplete: 0, returned: 0, form: "reviewed", laterTl: 0, needReview: 0,
    },
    {
      id: "c8", ref: "TEST-0008", accidentDays: -28, location: "Holton Road, Barry",
      circumstances: "Repairs complete. Customer has not yet collected the repaired vehicle. Hire remains on until return.",
      claimType: "non_fault", casLiab: "non_fault", insLiab: "admitted",
      rw: "unroadworthy", rwWho: "Megan Price", rwWhenDays: -28, rwWhy: "Initially undriveable; now repaired and ready.",
      position: "Repairs complete — awaiting customer return (hire still running)", handler: "staff-megan",
      lastCorrDays: 0, next: "Arrange customer collection of repaired vehicle", nextDueDays: 0,
      client: "p-haf", vehicle: "v-haf", ownIns: "AXA", ownPol: "AX-44119", ownClm: "AX-CL-1002",
      incomplete: 0, enquiry: 0, repair: "awaiting_return", eng: "report_received", hire: "active",
      recovery: "complete", storage: "ended", salvage: "none", tl: 0, qualify: 0, offHireDays: null, storageEndDays: -10,
      repairsComplete: 1, returned: 0, form: "reviewed", laterTl: 0, needReview: 0,
    },
    {
      id: "c9", ref: "TEST-0009", accidentDays: -16, location: "Cwmbran Drive, Cwmbran",
      circumstances: "Declared total loss after engineer inspection. Payment awaited. Salvage awaiting collection. Hire continues.",
      claimType: "non_fault", casLiab: "non_fault", insLiab: "admitted",
      rw: "unroadworthy", rwWho: "Engineer + Megan Price", rwWhenDays: -16, rwWhy: "Category S proposed; staff verified engineer extraction.",
      position: "Total loss — payment awaited; salvage awaiting collection", handler: "staff-megan",
      lastCorrDays: -2, next: "Chase vehicle damage payment from Hastings", nextDueDays: 0,
      client: "p-ioan", vehicle: "v-ioan", ownIns: "Hastings", ownPol: "HA-88221", ownClm: "HA-CL-7741",
      incomplete: 0, enquiry: 0, repair: "not_applicable", eng: "report_received", hire: "active",
      recovery: "complete", storage: "active", salvage: "awaiting_collection", tl: 1, qualify: 0, offHireDays: null, storageEndDays: null,
      repairsComplete: 0, returned: 0, form: "reviewed", laterTl: 0, needReview: 0,
    },
    {
      id: "c10", ref: "TEST-0010", accidentDays: -40, location: "Ocean Way, Cardiff",
      circumstances: "Business client total loss. Qualifying payment received. Off-hire countdown running. Storage billing end recorded separately.",
      claimType: "non_fault", casLiab: "non_fault", insLiab: "admitted",
      rw: "unroadworthy", rwWho: "Sian Evans", rwWhenDays: -40, rwWhy: "Transit van written off; work use recorded.",
      position: "Total loss — qualifying payment received; off-hire approaching", handler: "staff-sian",
      lastCorrDays: 0, next: "Collect hire vehicle on scheduled off-hire date", nextDueDays: 5,
      client: "p-jess", vehicle: "v-jess", ownIns: "AXA Business", ownPol: "AXB-12009", ownClm: "AXB-CL-3001",
      incomplete: 0, enquiry: 0, repair: "not_applicable", eng: "report_received", hire: "approaching_off_hire",
      recovery: "complete", storage: "active", salvage: "retained_by_insurer", tl: 1, qualify: 1, offHireDays: 5, storageEndDays: 2,
      repairsComplete: 0, returned: 0, form: "reviewed", laterTl: 0, needReview: 0,
    },
    {
      id: "c11", ref: "TEST-0011", accidentDays: -86, location: "A469, Caerphilly",
      circumstances: "Long-running non-fault hire. Current agreement is around day 80. Renewal is unsigned — do not fake a signature.",
      claimType: "non_fault", casLiab: "non_fault", insLiab: "denied",
      rw: "unroadworthy", rwWho: "Tom Hughes", rwWhenDays: -86, rwWhy: "Undriveable from outset; like-for-like 7-seat Sportage.",
      position: "Hire agreement approaching day 80 — unsigned renewal", handler: "staff-tom",
      lastCorrDays: -1, next: "Obtain signature on renewal agreement before day 88", nextDueDays: 0,
      client: "p-kieran", vehicle: "v-kieran", ownIns: "Admiral", ownPol: "ADM-22910", ownClm: "ADM-CL-6102",
      incomplete: 0, enquiry: 0, repair: "not_applicable", eng: "report_received", hire: "active",
      recovery: "complete", storage: "ended", salvage: "none", tl: 0, qualify: 0, offHireDays: null, storageEndDays: -70,
      repairsComplete: 0, returned: 0, form: "reviewed", laterTl: 0, needReview: 0,
    },
    {
      id: "c12", ref: "TEST-0012", accidentDays: -120, location: "Cathedral Road, Cardiff",
      circumstances: "Negotiations stalled. Offer received and awaiting review — not treated as payment. Litigation deadline from a specific protocol letter.",
      claimType: "non_fault", casLiab: "non_fault", insLiab: "denied",
      rw: "roadworthy", rwWho: "Justin Roberts", rwWhenDays: -120, rwWhy: "Initially roadworthy; later declared total loss after hidden damage. Replacement-need flagged for staff.",
      position: "Litigation monitoring — offer awaiting review", handler: "staff-megan",
      lastCorrDays: -1, next: "Review without-prejudice offer and protocol deadline", nextDueDays: 4,
      client: "p-lowri", vehicle: "v-lowri", ownIns: "Aviva", ownPol: "AV-99811", ownClm: "AV-CL-1200",
      incomplete: 0, enquiry: 0, repair: "not_applicable", eng: "report_received", hire: "ended",
      recovery: "none", storage: "none", salvage: "disposed", tl: 1, qualify: 1, offHireDays: -20, storageEndDays: -30,
      repairsComplete: 0, returned: 1, form: "reviewed", laterTl: 1, needReview: 1,
    },
  ];

  for (const c of claims) {
    run(
      db,
      `INSERT INTO claims(
        id, file_reference, created_at, updated_at, accident_at, accident_location, circumstances,
        claim_type, cas_liability_assessment, insurer_liability_position, roadworthiness,
        roadworthiness_assessor, roadworthiness_assessed_at, roadworthiness_reasons, current_position,
        handler_id, last_correspondence_at, next_action, next_action_due, client_person_id, client_vehicle_id,
        own_insurer_name, own_policy_ref, own_claim_ref, own_excess_pence, incomplete_client_submission,
        is_new_enquiry, repair_status, engineering_status, hire_status, recovery_status, storage_status,
        salvage_status, total_loss, payment_qualifies_off_hire, off_hire_scheduled_on, storage_billing_end_on,
        repairs_complete, repaired_vehicle_returned, client_form_status, later_declared_total_loss, replacement_need_review
      ) VALUES (${Array(42).fill("?").join(",")})`,
      [
        c.id, c.ref, isoDaysFromNow(c.accidentDays), now, isoDaysFromNow(c.accidentDays, 8, 15),
        c.location, c.circumstances, c.claimType, c.casLiab, c.insLiab, c.rw, c.rwWho,
        c.rwWhenDays === null ? null : isoDaysFromNow(c.rwWhenDays, 10, 0), c.rwWhy, c.position,
        c.handler, c.lastCorrDays === null ? null : isoDaysFromNow(c.lastCorrDays, 16, 20),
        c.next, c.nextDueDays === null ? null : isoDaysFromNow(c.nextDueDays, 17, 0),
        c.client, c.vehicle, c.ownIns, c.ownPol, c.ownClm, c.id === "c4" ? pence(350) : null,
        c.incomplete, c.enquiry, c.repair, c.eng, c.hire, c.recovery, c.storage, c.salvage,
        c.tl, c.qualify, c.offHireDays === null ? null : isoDateFromNow(c.offHireDays),
        c.storageEndDays === null ? null : isoDateFromNow(c.storageEndDays),
        c.repairsComplete, c.returned, c.form, c.laterTl, c.needReview,
      ],
    );
  }

  const parties: Array<[string, string, string, string, number]> = [
    ["cp1", "c1", "p-aled", "client", 1],
    ["cp1d", "c1", "p-aled", "driver", 0],
    ["cp1o", "c1", "p-aled", "vehicle_owner", 0],
    ["cp1t", "c1", "p-tp1", "third_party", 0],
    ["cp2", "c2", "p-bethan", "client", 1],
    ["cp2d", "c2", "p-bethan", "driver", 0],
    ["cp2k", "c2", "p-bethan", "registered_keeper", 0],
    ["cp2t", "c2", "p-tp2", "third_party", 0],
    ["cp2w", "c2", "p-wit1", "witness", 0],
    ["cp3", "c3", "p-ceri", "client", 1],
    ["cp3d", "c3", "p-ceri", "driver", 0],
    ["cp3t", "c3", "p-tp3", "third_party", 0],
    ["cp4", "c4", "p-daf", "client", 1],
    ["cp4d", "c4", "p-daf", "driver", 0],
    ["cp5", "c5", "p-elin", "client", 1],
    ["cp6", "c6", "p-ffion", "client", 1],
    ["cp7", "c7", "p-gareth", "client", 1],
    ["cp8", "c8", "p-haf", "client", 1],
    ["cp9", "c9", "p-ioan", "client", 1],
    ["cp10", "c10", "p-jess", "client", 1],
    ["cp10d", "c10", "p-jess-driver", "driver", 0],
    ["cp10h", "c10", "p-jess", "hirer", 0],
    ["cp11", "c11", "p-kieran", "client", 1],
    ["cp12", "c12", "p-lowri", "client", 1],
  ];
  for (const p of parties) {
    run(db, "INSERT INTO claim_parties(id, claim_id, person_id, role, is_primary) VALUES (?, ?, ?, ?, ?)", p);
  }

  run(db, `INSERT INTO claim_third_parties(id, claim_id, person_id, vehicle_id, insurer_name, insurer_ref, representative, nomination_date)
    VALUES ('tp-c1','c1','p-tp1','v-tp-aled','Unknown','Unknown','Unknown', NULL)`);
  run(db, `INSERT INTO claim_third_parties(id, claim_id, person_id, vehicle_id, insurer_name, insurer_ref, representative, nomination_date)
    VALUES ('tp-c2','c2','p-tp2','v-tp-bethan','Aviva','AV-TP-8891','Keoghs (nominated)', ?)`, [isoDateFromNow(-8)]);
  run(db, `INSERT INTO claim_third_parties(id, claim_id, person_id, vehicle_id, insurer_name, insurer_ref, representative, nomination_date)
    VALUES ('tp-c3','c3','p-tp3',NULL,'Zurich','ZU-TP-4410','Unknown', NULL)`);
  run(db, `INSERT INTO claim_third_parties(id, claim_id, person_id, vehicle_id, insurer_name, insurer_ref, representative, nomination_date)
    VALUES ('tp-c5','c5','p-tp2',NULL,'Aviva','AV-TP-1022','DAC Beachcroft', ?)`, [isoDateFromNow(-4)]);
  run(db, `INSERT INTO claim_third_parties(id, claim_id, person_id, vehicle_id, insurer_name, insurer_ref, representative, nomination_date)
    VALUES ('tp-c12','c12','p-tp1',NULL,'Aviva','AV-TP-1200','Horwich Farrelly', ?)`, [isoDateFromNow(-40)]);

  // Reservations and hire
  run(db, `INSERT INTO reservations(id, fleet_vehicle_id, claim_id, start_at, end_at, kind, status, charges_started, created_by, created_at)
    VALUES ('r-c2','fv-1','c2', ?, ?, 'hire', 'reserved', 0, 'staff-sian', ?)`,
    [isoDaysFromNow(3, 8, 0), isoDaysFromNow(10, 18, 0), now]);
  run(db, `INSERT INTO reservations(id, fleet_vehicle_id, claim_id, start_at, end_at, kind, status, charges_started, created_by, created_at)
    VALUES ('r-c3','fv-2','c3', ?, ?, 'hire', 'active', 1, 'staff-tom', ?)`,
    [isoDaysFromNow(-6, 20, 0), isoDaysFromNow(21, 18, 0), now]);
  run(db, `INSERT INTO reservations(id, fleet_vehicle_id, claim_id, start_at, end_at, kind, status, charges_started, created_by, created_at)
    VALUES ('r-c4','fv-3','c4', ?, ?, 'courtesy', 'active', 0, 'staff-megan', ?)`,
    [isoDaysFromNow(-3, 9, 0), isoDaysFromNow(11, 18, 0), now]);
  run(db, `INSERT INTO reservations(id, fleet_vehicle_id, claim_id, start_at, end_at, kind, status, charges_started, created_by, created_at)
    VALUES ('r-c7','fv-7','c7', ?, ?, 'hire', 'active', 1, 'staff-tom', ?)`,
    [isoDaysFromNow(-18, 9, 0), isoDaysFromNow(10, 18, 0), now]);
  run(db, `INSERT INTO reservations(id, fleet_vehicle_id, claim_id, start_at, end_at, kind, status, charges_started, created_by, created_at)
    VALUES ('r-c8','fv-9','c8', ?, ?, 'hire', 'active', 1, 'staff-megan', ?)`,
    [isoDaysFromNow(-24, 9, 0), isoDaysFromNow(2, 18, 0), now]);
  run(db, `INSERT INTO reservations(id, fleet_vehicle_id, claim_id, start_at, end_at, kind, status, charges_started, created_by, created_at)
    VALUES ('r-c9','fv-5','c9', ?, ?, 'hire', 'active', 1, 'staff-megan', ?)`,
    [isoDaysFromNow(-16, 11, 0), isoDaysFromNow(20, 18, 0), now]);
  run(db, `INSERT INTO reservations(id, fleet_vehicle_id, claim_id, start_at, end_at, kind, status, charges_started, created_by, created_at)
    VALUES ('r-c11','fv-8','c11', ?, ?, 'hire', 'active', 1, 'staff-tom', ?)`,
    [isoDaysFromNow(-86, 10, 0), isoDaysFromNow(8, 18, 0), now]);

  run(db, `INSERT INTO hire_episodes(id, claim_id, fleet_vehicle_id, started_at, billing_end_at, collection_at, like_for_like, suitability_reason, credit_hire, rate_pence_per_day)
    VALUES ('h-c3','c3','fv-2', ?, NULL, NULL, 1, 'Client Golf is automatic; fleet Golf automatic, 5 seats, similar size.', 1, 8900)`,
    [isoDaysFromNow(-6, 20, 30)]);
  run(db, `INSERT INTO hire_episodes(id, claim_id, fleet_vehicle_id, started_at, billing_end_at, collection_at, like_for_like, suitability_reason, credit_hire, rate_pence_per_day)
    VALUES ('h-c4','c4','fv-3', ?, NULL, NULL, 0, 'Fault courtesy — Corsa is adequate transport, not like-for-like, not credit hire.', 0, NULL)`,
    [isoDaysFromNow(-3, 9, 15)]);
  run(db, `INSERT INTO hire_episodes(id, claim_id, fleet_vehicle_id, started_at, billing_end_at, collection_at, like_for_like, suitability_reason, credit_hire, rate_pence_per_day)
    VALUES ('h-c7','c7','fv-7', ?, NULL, NULL, 1, 'Automatic estate needed; Prius automatic accepted as closest available at handover.', 1, 7200)`,
    [isoDaysFromNow(-18, 9, 40)]);
  run(db, `INSERT INTO hire_episodes(id, claim_id, fleet_vehicle_id, started_at, billing_end_at, collection_at, like_for_like, suitability_reason, credit_hire, rate_pence_per_day)
    VALUES ('h-c8','c8','fv-9', ?, NULL, NULL, 1, 'Automatic family car; Octavia estate matches seats and transmission.', 1, 7900)`,
    [isoDaysFromNow(-24, 9, 10)]);
  run(db, `INSERT INTO hire_episodes(id, claim_id, fleet_vehicle_id, started_at, billing_end_at, collection_at, like_for_like, suitability_reason, credit_hire, rate_pence_per_day)
    VALUES ('h-c9','c9','fv-5', ?, NULL, NULL, 1, 'Like-for-like Mercedes C-class automatic from fleet stock.', 1, 12500)`,
    [isoDaysFromNow(-16, 11, 5)]);
  run(db, `INSERT INTO hire_episodes(id, claim_id, fleet_vehicle_id, started_at, billing_end_at, collection_at, like_for_like, suitability_reason, credit_hire, rate_pence_per_day)
    VALUES ('h-c10','c10','fv-6', ?, ?, NULL, 1, 'Work van replacement. Fleet Transit was used until qualifying payment; vehicle now in maintenance after return planning.', 1, 9500)`,
    [isoDaysFromNow(-38, 8, 0), isoDaysFromNow(5, 18, 0)]);
  run(db, `INSERT INTO hire_episodes(id, claim_id, fleet_vehicle_id, started_at, billing_end_at, collection_at, like_for_like, suitability_reason, credit_hire, rate_pence_per_day)
    VALUES ('h-c11','c11','fv-8', ?, NULL, NULL, 1, 'Client Sportage automatic 5+ seats; fleet 7-seat Sportage is suitable like-for-like.', 1, 9800)`,
    [isoDaysFromNow(-86, 10, 20)]);

  run(db, `INSERT INTO agreements(id, hire_episode_id, sequence, start_on, planned_end_on, max_days, renewal_alert_day, signed, signed_at, signature_status, template_note)
    VALUES ('ag-c3','h-c3', 1, ?, ?, 88, 80, 1, ?, 'signed', 'CAS credit-hire template not yet supplied — placeholder terms only.')`,
    [isoDateFromNow(-6), isoDateFromNow(82), isoDaysFromNow(-6, 20, 45)]);
  run(db, `INSERT INTO agreements(id, hire_episode_id, sequence, start_on, planned_end_on, max_days, renewal_alert_day, signed, signed_at, signature_status, template_note)
    VALUES ('ag-c11a','h-c11', 1, ?, ?, 88, 80, 1, ?, 'signed', 'First agreement. Template dependency: CAS hire agreement.')`,
    [isoDateFromNow(-86), isoDateFromNow(2), isoDaysFromNow(-86, 10, 40)]);
  run(db, `INSERT INTO agreements(id, hire_episode_id, sequence, start_on, planned_end_on, max_days, renewal_alert_day, signed, signed_at, signature_status, template_note)
    VALUES ('ag-c11b','h-c11', 2, ?, ?, 88, 80, 0, NULL, 'unsigned_urgent', 'Renewal prepared around day 80. Must not be marked signed. Linked to same hire episode.')`,
    [isoDateFromNow(-6), isoDateFromNow(82)]);

  run(db, `INSERT INTO handovers(id, hire_episode_id, type, occurred_at, mileage, fuel_level, condition_notes, signed)
    VALUES ('ho-c3','h-c3','handover', ?, 42110, 'three_quarters', 'No new damage. Keys and charging cable n/a.', 1)`,
    [isoDaysFromNow(-6, 20, 30)]);

  // Financials — claimed / offered / agreed / received kept distinct
  const fin = (
    id: string, claim: string, head: string, desc: string, qty: number, unit: string, rate: number,
    claimed: number, offered: number, agreed: number, received: number, offerStatus: string | null,
  ) => {
    const net = claimed > 0 ? claimed : rate * qty;
    const vat = vatOnNet(net);
    run(db, `INSERT INTO financial_lines(
      id, claim_id, head_of_loss, description, quantity, unit, rate_pence, net_pence, vat_pence, gross_pence,
      claimed_pence, offered_pence, agreed_pence, received_pence, offer_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, claim, head, desc, qty, unit, rate, net, vat, net + vat, claimed, offered, agreed, received, offerStatus]);
  };

  fin("f-c3-hire", "c3", "hire", "Like-for-like credit hire", 6, "days", 8900, pence(534), 0, 0, 0, null);
  fin("f-c3-rec", "c3", "recovery", "Recovery from M4 J42", 1, "job", pence(395), pence(395), 0, 0, 0, null);
  fin("f-c3-st", "c3", "storage", "Storage at CAS yard", 6, "days", 3900, pence(234), 0, 0, 0, null);
  fin("f-c4-c", "c4", "courtesy", "Courtesy vehicle — no credit-hire rate applied", 3, "days", 0, 0, 0, 0, 0, null);
  fin("f-c6-rep", "c6", "repairs", "Estimated repairs (staff-verified engineer figure)", 1, "job", pence(2400), pence(2400), 0, 0, 0, null);
  fin("f-c7-hire", "c7", "hire", "Hire during repairs", 18, "days", 7200, pence(1296), 0, pence(900), 0, null);
  fin("f-c8-hire", "c8", "hire", "Hire until repaired vehicle returned", 24, "days", 7900, pence(1896), 0, pence(1896), 0, null);
  fin("f-c9-hire", "c9", "hire", "Total-loss hire (countdown not started — payment not qualifying yet)", 16, "days", 12500, pence(2000), pence(800), 0, 0, "awaiting_review");
  fin("f-c9-vd", "c9", "vehicle_damage", "Gross PAV claimed", 1, "item", pence(14500), pence(14500), pence(12000), 0, 0, "awaiting_review");
  fin("f-c9-sal", "c9", "salvage_shortfall", "Salvage deduction proposed — proceeds not double-counted", 1, "item", pence(1800), pence(1800), 0, 0, 0, null);
  fin("f-c10-hire", "c10", "hire", "Work van hire", 38, "days", 9500, pence(3610), 0, pence(3610), pence(3610), null);
  fin("f-c10-vd", "c10", "vehicle_damage", "PAV paid (qualifying)", 1, "item", pence(8200), pence(8200), 0, pence(8200), pence(8200), null);
  fin("f-c11-hire", "c11", "hire", "Continuous hire episode (do not double-bill across agreements)", 86, "days", 9800, pence(8428), 0, 0, 0, null);
  fin("f-c12-hire", "c12", "hire", "Historical hire", 40, "days", 11000, pence(4400), pence(2000), 0, 0, "awaiting_review");
  fin("f-c12-vd", "c12", "vehicle_damage", "Total loss vehicle damage", 1, "item", pence(18000), pence(18000), pence(14000), 0, 0, "awaiting_review");

  // Tasks
  const task = (id: string, claim: string, handler: string, title: string, details: string, type: string, dueDays: number, status: string) => {
    run(db, `INSERT INTO tasks(id, claim_id, handler_id, title, details, type, due_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, claim, handler, title, details, type, isoDaysFromNow(dueDays, 16, 0), status, now]);
  };
  task("t1", "c1", "staff-sian", "Complete incomplete client submission", "Telephone capture remaining photographs and third-party registration.", "client_form", 0, "open");
  task("t2", "c2", "staff-sian", "Book repair — reservation only", "Do not start hire charges until the vehicle is in and replacement supplied.", "repairs", 1, "open");
  task("t3", "c3", "staff-tom", "Chase Zurich liability", "First chase. Call preferred before escalation.", "liability", 0, "open");
  task("t4", "c4", "staff-megan", "Confirm courtesy return date", "Fault courtesy — no credit-hire invoice.", "hire", 2, "open");
  task("t5", "c5", "staff-sian", "Engineer report overdue chase", "Inspection done; report not in.", "engineering", -1, "open");
  task("t6", "c6", "staff-tom", "Chase Ageas repair authorisation", "Report dispatched; unanswered. 3 calendar day demonstration interval.", "repair_auth", 0, "open");
  task("t7", "c8", "staff-megan", "Customer return of repaired vehicle", "Completion alone does not end hire.", "off_hire", 0, "open");
  task("t8", "c9", "staff-megan", "Salvage collection / disposal authority", "Do not treat offer as qualifying payment.", "salvage", 1, "open");
  task("t9", "c10", "staff-sian", "Collect hire vehicle on scheduled off-hire", "7 days after qualifying payment. Storage end is a separate date.", "off_hire", 5, "open");
  task("t10", "c11", "staff-tom", "Unsigned renewal near expiry", "Urgent exception. Do not mark signed or backdate.", "agreement_renewal", 0, "open");
  task("t11", "c12", "staff-megan", "Review without-prejudice offer", "£2,000 offered against hire is not a receipt or settlement.", "offer_review", 1, "open");
  task("t12", "c12", "staff-tom", "Overdue: locate rate evidence", "Needed for this dispute only — not a global financial-evidence demand.", "litigation", -2, "open");
  task("t13", "c11", "staff-sian", "Call client before escalating insurer chase", "Justin preference: telephone attempt before escalation.", "call", 0, "open");

  run(db, `INSERT INTO notes(id, claim_id, author_id, body, created_at) VALUES
    ('n1','c1','staff-sian', ?, ?),
    ('n2','c2','staff-sian', ?, ?),
    ('n3','c4','staff-megan', ?, ?),
    ('n4','c8','staff-megan', ?, ?),
    ('n5','c11','staff-tom', ?, ?),
    ('n6','c12','staff-justin', ?, ?)`,
    [
      "Client started the form on a mobile link then dropped out. Staff to complete by telephone. Client-entered facts kept separate until reviewed.",
      now,
      "Roadworthy vehicle staying with client. BMW 320i reserved for the repair window only. Opening the file did not start hire.",
      now,
      "Fault courtesy Corsa allocated. No credit-hire rates and no third-party recovery assumption.",
      now,
      "Bodyshop marked repairs complete at 09:40. Customer not yet collected. Hire billing continues until the repaired vehicle is returned.",
      now,
      "Day 80 renewal prepared. Client has not signed. Left as unsigned_urgent. Same hire episode — no gap, no double billing.",
      now,
      "Incoming offer is without prejudice and awaits review. Not an acceptance and not a receipt. Court issue remains unapproved.",
      now,
    ],
  );

  run(db, `INSERT INTO correspondence(id, claim_id, direction, channel, subject, preview, unread, sent_status, created_at) VALUES
    ('co1','c1','incoming','form','Incomplete client submission','Client saved progress; licence upload missing.', 1, 'received', ?),
    ('co2','c3','outgoing','email','Our ref: TEST-0003  Your policy: ZU-TP-4410','Liability notification. Simulated send — not a live email.', 0, 'simulated_sent', ?),
    ('co3','c6','outgoing','email','Engineer report — TEST-0006','Report dispatched to Ageas. Chaser track started (3 calendar days, labelled demo setting).', 0, 'simulated_sent', ?),
    ('co4','c9','incoming','email','Offer in respect of hire','£800 offered against hire. Awaiting review.', 1, 'received', ?),
    ('co5','c12','incoming','email','Without prejudice offer','Offer received. Not allocated as payment.', 1, 'received', ?),
    ('co6','c12','outgoing','letter','Protocol letter (approved copy on file)','Retained as sent copy. Live sending is blocked in prototype.', 0, 'simulated_sent', ?)`,
    [isoDaysFromNow(0, 11, 0), isoDaysFromNow(-1, 9, 12), isoDaysFromNow(-3, 14, 0), isoDaysFromNow(-2, 15, 41), isoDaysFromNow(-1, 10, 5), isoDaysFromNow(-21, 9, 0)]);

  run(db, `INSERT INTO documents(id, claim_id, title, kind, version, signed, simulated, created_at) VALUES
    ('d1','c2','Repair estimate','estimate',1,0,1,?),
    ('d2','c3','Hire agreement (signed copy uploaded)','agreement',1,1,1,?),
    ('d3','c6','Engineer report (staff verified)','engineer_report',1,0,1,?),
    ('d4','c11','Renewal agreement — unsigned','agreement',2,0,1,?),
    ('d5','c12','Schedule of loss draft','schedule',1,0,1,?)`,
    [now, now, now, now, now]);

  run(db, `INSERT INTO automations(id, claim_id, rule_key, track, next_run_at, interval_days, interval_unit, paused, last_outcome, reason, status) VALUES
    ('a1','c6','engineer_report_chaser','engineer_report', ?, 3, 'calendar_days', 0, 'report_dispatched', 'Demonstration: chase every 3 calendar days until answered.', 'due'),
    ('a2','c5','liability_chaser','liability', ?, 3, 'calendar_days', 0, NULL, 'Awaiting Aviva response. Call task preferred before escalation.', 'scheduled'),
    ('a3','c11','liability_chaser','liability', ?, 14, 'calendar_days', 0, 'insurer_override', 'Insurer-specific 14-day interval override (Admiral file).', 'scheduled'),
    ('a4','c3','liability_chaser','liability', NULL, 3, 'calendar_days', 1, 'paused', 'Handler pause — do not send.', 'paused')`,
    [isoDaysFromNow(0, 10, 0), isoDaysFromNow(1, 10, 0), isoDaysFromNow(8, 10, 0)]);

  run(db, `INSERT INTO litigation(id, claim_id, stage, deadline_on, deadline_source, deadline_trigger, reviewer, approved_to_issue) VALUES
    ('l1','c12','pre_action', ?, 'Letter of claim dated 21 days ago — response period under the Pre-Action Protocol for Low Value PI? No: this is a vehicle damage / hire protocol letter on file, not a generic invented date.', 'Protocol response window from the dated letter on the file', 'Justin Roberts', 0)` ,
    [isoDateFromNow(4)]);

  run(db, `INSERT INTO mid_lookups(id, claim_id, registration, accident_on, lookup_on, insurer, checker_id, evidence, source) VALUES
    ('m1','c2','WN12 PSH', ?, ?, 'Aviva', 'staff-sian', 'Manual authorised MID check recorded. Screenshot not attached in prototype.', 'manual'),
    ('m2','c3','SA12 CWA', ?, ?, 'Direct Line', 'staff-tom', 'Own insurer confirmed by client; TP insurer from manual MID. Simulated evidence placeholder.', 'manual')`,
    [isoDateFromNow(-12), isoDateFromNow(-11), isoDateFromNow(-6), isoDateFromNow(-6)]);

  run(db, `INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details) VALUES
    ('au1', ?, 'system', 'seed', 'database', 'prototype', 'Fictional TEST claims loaded. Prototype — fictional test data.')`,
    [now]);

  insertPrototypeChronology(db);
}

export function backfillChronologyIfEmpty(db: DatabaseSync) {
  const row = db.prepare("SELECT COUNT(*) AS c FROM claim_events").get() as { c: number };
  if (Number(row.c) > 0) return;
  const claim = db.prepare("SELECT id FROM claims WHERE id = 'c3'").get();
  if (!claim) return;
  insertPrototypeChronology(db);
}

function insertPrototypeChronology(db: DatabaseSync) {
  const now = nowUtcIso();
  const ev = (
    id: string,
    claim: string,
    type: string,
    title: string,
    details: string,
    days: number,
    hours: number,
    actor: string,
    channel: string,
  ) => {
    run(
      db,
      `INSERT OR IGNORE INTO claim_events(
        id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, channel, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff')`,
      [id, claim, type, title, details, isoDaysFromNow(days, hours, 0), now, actor, channel],
    );
  };

  ev("ev-c1-open", "c1", "file_opened", "File opened", "New enquiry opened. Client form incomplete.", -1, 11, "staff-sian", "system");
  ev("ev-c1-acc", "c1", "accident", "Accident", "Newport Road, Cardiff.", -1, 8, "staff-sian", "system");

  ev("ev-c2-open", "c2", "file_opened", "File opened", "Roadworthy non-fault file opened.", -12, 9, "staff-sian", "system");
  ev("ev-c2-acc", "c2", "accident", "Accident", "Windsor Road, Penarth.", -12, 8, "staff-sian", "system");
  ev("ev-c2-eng", "c2", "engineer_instructed", "Engineer instructed", "Instructed in parallel with liability.", -10, 10, "staff-sian", "email");

  ev("ev-c3-open", "c3", "file_opened", "File opened", "Undriveable non-fault.", -6, 19, "staff-tom", "system");
  ev("ev-c3-acc", "c3", "accident", "Accident", "M4 Junction 42, Swansea.", -6, 18, "staff-tom", "system");
  ev("ev-c3-rec", "c3", "recovery_completed", "Recovery completed", "Recovered the same evening.", -6, 20, "staff-tom", "system");
  ev("ev-c3-st", "c3", "storage_started", "Vehicle entered storage", "Entered CAS yard.", -6, 21, "staff-tom", "system");
  ev("ev-c3-hire", "c3", "hire_started", "Hire / courtesy started", "Like-for-like automatic Golf supplied at handover.", -6, 20, "staff-tom", "system");
  ev("ev-c3-letter", "c3", "initial_letter_tp_insurer", "Initial letter to third-party insurer", "Notification to Zurich. Simulated send.", -1, 9, "staff-tom", "email");
  ev("ev-c3-eng", "c3", "engineer_instructed", "Engineer instructed", "Instructed in parallel with liability.", -5, 10, "staff-tom", "email");

  ev("ev-c4-hire", "c4", "hire_started", "Hire / courtesy started", "Fault courtesy Corsa — not credit hire.", -3, 9, "staff-megan", "system");

  ev("ev-c5-eng", "c5", "engineer_instructed", "Engineer instructed", "Inspection arranged; report not yet in.", -7, 11, "staff-sian", "email");

  ev("ev-c6-letter", "c6", "initial_letter_tp_insurer", "Initial letter to third-party insurer", "Ageas notified.", -16, 9, "staff-tom", "email");
  ev("ev-c6-eng", "c6", "engineer_instructed", "Engineer instructed", "Engineer instructed.", -8, 10, "staff-tom", "email");
  ev("ev-c6-rep", "c6", "engineer_report_received", "Engineer report received", "Staff verified extraction before use.", -5, 14, "staff-tom", "email");

  ev("ev-c7-rec", "c7", "recovery_completed", "Recovery completed", "Recovered to CAS.", -21, 10, "staff-tom", "system");
  ev("ev-c7-hire", "c7", "hire_started", "Hire / courtesy started", "Prius supplied at actual handover.", -18, 9, "staff-tom", "system");
  ev("ev-c7-eng", "c7", "engineer_instructed", "Engineer instructed", "Engineer instructed.", -20, 11, "staff-tom", "email");
  ev("ev-c7-repr", "c7", "engineer_report_received", "Engineer report received", "Repairable.", -19, 16, "staff-tom", "email");
  ev("ev-c7-start", "c7", "repairs_started", "Repairs started", "In the bodyshop. Parts chase outstanding.", -14, 8, "staff-tom", "system");

  ev("ev-c8-hire", "c8", "hire_started", "Hire / courtesy started", "Hire from handover.", -24, 9, "staff-megan", "system");
  ev("ev-c8-start", "c8", "repairs_started", "Repairs started", "Bodyshop start.", -20, 8, "staff-megan", "system");
  ev("ev-c8-done", "c8", "repairs_complete", "Repairs complete", "Complete. Customer has not yet collected. Hire still running.", 0, 9, "staff-megan", "system");

  ev("ev-c9-letter", "c9", "initial_letter_tp_insurer", "Initial letter to third-party insurer", "Hastings notified.", -15, 10, "staff-megan", "email");
  ev("ev-c9-eng", "c9", "engineer_instructed", "Engineer instructed", "Total loss inspection.", -14, 11, "staff-megan", "email");
  ev("ev-c9-offer", "c9", "offer_received", "Offer received", "Hire offer under review — not a payment.", -2, 15, "staff-megan", "email");

  ev("ev-c12-letter", "c12", "initial_letter_tp_insurer", "Initial letter to third-party insurer", "Aviva notified historically.", -110, 9, "staff-megan", "letter");
  ev("ev-c12-offer", "c12", "offer_received", "Offer received", "Without-prejudice offer awaiting review.", -1, 10, "staff-megan", "email");
}

