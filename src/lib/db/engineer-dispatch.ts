import { formatUkDate, formatUkDateTime, londonTodayIso, nowUtcIso } from "../dates";
import { liabilityStatusLabel, roadworthinessLabel } from "../domain/claim-status";
import { CAS_COMPANY } from "../documents/cas-hire-terms";
import { all, get, newId, run } from "./connection";
import { generateClaimDocument, letterPreview, recordClaimEvent, sendClaimEmail } from "./chronology";
import { getEngineer, listActiveEngineers, SEEDED_ENGINEER } from "./engineers";
import { getSettings } from "./queries";
import { recordedVehicleLocationForClaim } from "./vehicle-location";

/**
 * R65: step 5 sends the engineer instruction (and/or hands the Audatex estimate to the estimator) in one click, with
 * everything the engineer needs from the file. Email is simulated until CAS's mailbox is connected.
 */

export const SETTING_DEFAULT_ENGINEER = "default_engineer_id";
export const SETTING_ENGINEER_CC = "engineer_instruction_cc";
export const SETTING_AUDATEX_ESTIMATOR = "audatex_estimator_staff_id";

function setting(key: string): string {
  return String(getSettings()[key] || "").trim();
}

function saveSetting(key: string, value: string) {
  run(`INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value]);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Settings → Engineers: the default engineer, extra CC addresses, and who prepares Audatex estimates. */
export function engineerDispatchSettings() {
  const cc = setting(SETTING_ENGINEER_CC)
    .split(/[,;\s]+/)
    .map((address) => address.trim())
    .filter(Boolean);
  return { defaultEngineerId: setting(SETTING_DEFAULT_ENGINEER), extraCc: cc, estimatorId: setting(SETTING_AUDATEX_ESTIMATOR) };
}

export function saveEngineerDispatchSettings(input: { defaultEngineerId: string; extraCc: string; estimatorId: string }) {
  const engineer = input.defaultEngineerId ? getEngineer(input.defaultEngineerId) : null;
  if (input.defaultEngineerId && (!engineer || engineer.active !== 1)) throw new Error("Choose the default engineer from the saved list.");
  const cc = input.extraCc
    .split(/[,;\s]+/)
    .map((address) => address.trim())
    .filter(Boolean);
  const bad = cc.find((address) => !EMAIL.test(address));
  if (bad) throw new Error(`"${bad.slice(0, 60)}" is not an email address.`);
  if (input.estimatorId) {
    const staff = get<{ id: string }>(`SELECT id FROM staff WHERE id = ? AND active = 1`, [input.estimatorId]);
    if (!staff) throw new Error("Choose the Audatex estimator from the staff list.");
  }
  saveSetting(SETTING_DEFAULT_ENGINEER, input.defaultEngineerId);
  saveSetting(SETTING_ENGINEER_CC, cc.join(", "));
  saveSetting(SETTING_AUDATEX_ESTIMATOR, input.estimatorId);
}

type ClaimFacts = {
  file_reference: string;
  handler_id: string | null;
  handler_name: string | null;
  handler_email: string | null;
  client_name: string | null;
  client_mobile: string | null;
  client_telephone: string | null;
  registration: string | null;
  make: string | null;
  model: string | null;
  colour: string | null;
  fuel: string | null;
  accident_at: string | null;
  circumstances: string | null;
  damage_description: string | null;
  roadworthiness: string | null;
  claim_type: string | null;
  engineer_id: string | null;
};

function facts(claimId: string): ClaimFacts | undefined {
  return get<ClaimFacts>(
    `SELECT c.file_reference, c.handler_id, s.name AS handler_name, s.email AS handler_email,
            p.full_name AS client_name, p.mobile_tel AS client_mobile, p.telephone AS client_telephone,
            v.registration, v.make, v.model, v.colour, v.fuel,
            c.accident_at, c.circumstances, c.damage_description, c.roadworthiness, c.claim_type, c.engineer_id
     FROM claims c
     LEFT JOIN staff s ON s.id = c.handler_id
     LEFT JOIN people p ON p.id = c.client_person_id
     LEFT JOIN vehicles v ON v.id = c.client_vehicle_id
     WHERE c.id = ?`,
    [claimId],
  );
}

/** The engineers that can be instructed on this file. TEST files never use CAS's real engineer (R40). */
export function engineersFor(claimId: string): Array<{ id: string; name: string; email: string }> {
  const testFile = String(facts(claimId)?.file_reference || "").startsWith("TEST-");
  return listActiveEngineers()
    .filter((engineer) => !(testFile && engineer.liveOnly === 1))
    .map((engineer) => ({ id: engineer.id, name: engineer.name, email: engineer.email }));
}

/** The engineer to instruct by default: the file's own, then Settings' default, then the fictional engineer on TEST files. */
export function defaultEngineerFor(claimId: string): string {
  const options = engineersFor(claimId);
  const ids = new Set(options.map((engineer) => engineer.id));
  const claim = facts(claimId);
  for (const id of [claim?.engineer_id || "", engineerDispatchSettings().defaultEngineerId, SEEDED_ENGINEER.id]) {
    if (id && ids.has(id)) return id;
  }
  return options[0]?.id || "";
}

/** Photos of the vehicle on the file (not licences, statements or logbooks), attached to the instruction. */
export function vehiclePhotoIds(claimId: string): string[] {
  return all<{ id: string }>(
    `SELECT id FROM documents WHERE claim_id = ? AND mime_type LIKE 'image/%'
       AND COALESCE(document_type, '') NOT IN ('driving_licence', 'licence_check', 'bank_statements', 'impecuniosity_evidence', 'v5c_client', 'v5c_cas', 'insurance_certificate')
     ORDER BY created_at LIMIT 10`,
    [claimId],
  ).map((row) => String(row.id));
}

export type DispatchGap = { label: string; href: string; blocking: boolean };

/** What stops the instruction going (blocking), and what only warns (no photos). */
export function instructionGaps(claimId: string, engineerId: string): DispatchGap[] {
  const claim = facts(claimId);
  const base = `/claims/${claimId}`;
  const gaps: DispatchGap[] = [];
  if (!claim) return [{ label: "File not found", href: "/claims", blocking: true }];
  const engineer = engineerId ? getEngineer(engineerId) : null;
  if (!engineer) gaps.push({ label: "No engineer chosen", href: "/settings/engineers", blocking: true });
  else if (!EMAIL.test(engineer.email)) gaps.push({ label: "No email for the engineer", href: "/settings/engineers", blocking: true });
  // Where the car is must be recorded on this file; the Settings default (CAS premises) is not a confirmation.
  if (!recordedVehicleLocationForClaim(claimId).trim()) gaps.push({ label: "No vehicle location recorded on the file", href: `${base}/details/vehicle`, blocking: true });
  if (!String(claim.registration || "").trim() || /^unknown$/i.test(String(claim.registration))) gaps.push({ label: "No vehicle registration", href: `${base}/vehicles`, blocking: true });
  if (!String(claim.client_mobile || claim.client_telephone || "").trim()) gaps.push({ label: "No client phone number (to arrange access)", href: `${base}/details/client`, blocking: true });
  if (!claim.accident_at) gaps.push({ label: "No accident date", href: `${base}/details/accident`, blocking: true });
  if (!vehiclePhotoIds(claimId).length) gaps.push({ label: "No photos on the file – send anyway?", href: `${base}/documents`, blocking: false });
  return gaps;
}

/** The short block added to the supplied instruction for what the template has no place for (shown to Justin in Settings). */
export function instructionAdditions(claimId: string): string[] {
  const claim = facts(claimId);
  if (!claim) return [];
  const tp = get<{ insurer_name: string | null; insurer_ref: string | null; policy_number: string | null }>(
    `SELECT insurer_name, insurer_ref, policy_number FROM claim_third_parties WHERE claim_id = ? ORDER BY sequence LIMIT 1`,
    [claimId],
  );
  const lines = [
    `Handler: ${claim.handler_name || "Complete Accident Solutions"}, ${CAS_COMPANY.phone}`,
    `Client: ${claim.client_name || "not on the file"}, ${claim.client_mobile || claim.client_telephone || "no phone on the file"} (to arrange access)`,
    `Vehicle colour and fuel: ${[claim.colour, claim.fuel].filter((part) => String(part || "").trim()).join(", ") || "not on the file"}`,
    `Circumstances: ${String(claim.circumstances || "not on the file").replace(/\s+/g, " ").slice(0, 300)}`,
    `Damage described: ${String(claim.damage_description || "not on the file").replace(/\s+/g, " ").slice(0, 300)}`,
    `Roadworthiness: ${roadworthinessLabel(claim.roadworthiness)}`,
    `Third-party insurer: ${tp?.insurer_name || "not on the file"}${tp?.insurer_ref ? `, their reference ${tp.insurer_ref}` : ""}${tp?.policy_number ? `, policy ${tp.policy_number}` : ""}`,
    `Liability status: ${liabilityStatusLabel(claim.claim_type)}`,
    "What we need back: your inspection date, the report with photographs and the repair estimate; if the vehicle is uneconomical to repair, the pre-accident value and the salvage category.",
  ];
  return lines;
}

/** The instruction as it will go: the supplied wording filled from the file, then the additions. */
export function instructionContent(claimId: string, engineerId: string) {
  const letter = letterPreview(claimId, "engineer_instruction", undefined, engineerId);
  const additions = instructionAdditions(claimId);
  const body = `${letter.text.trim()}\n\nFrom the claim file:\n${additions.map((line) => `- ${line}`).join("\n")}`;
  return { subject: letter.subject, body, missing: letter.missing };
}

export type DispatchView = {
  route: string;
  engineers: Array<{ id: string; name: string; email: string }>;
  defaultEngineerId: string;
  handlerName: string;
  cc: string[];
  estimator: { id: string; name: string; email: string } | null;
  photos: number;
  instructed: { at: string; details: string } | null;
  audatexSent: { at: string; details: string } | null;
};

function latestEvent(claimId: string, type: string) {
  const row = get<{ occurred_at: string; details: string | null }>(
    `SELECT occurred_at, details FROM claim_events WHERE claim_id = ? AND event_type = ? ORDER BY occurred_at DESC, recorded_at DESC LIMIT 1`,
    [claimId, type],
  );
  return row ? { at: String(row.occurred_at), details: String(row.details || "") } : null;
}

const AUDATEX_REQUEST = "for the Audatex estimate";

function audatexRequest(claimId: string) {
  const row = get<{ occurred_at: string; details: string | null }>(
    `SELECT occurred_at, details FROM claim_events WHERE claim_id = ? AND event_type = 'other' AND details LIKE ? ORDER BY occurred_at DESC LIMIT 1`,
    [claimId, `Sent to % ${AUDATEX_REQUEST}%`],
  );
  return row ? { at: String(row.occurred_at), details: String(row.details || "") } : null;
}

function ccFor(claimId: string): string[] {
  const claim = facts(claimId);
  const settings = engineerDispatchSettings();
  return [...new Set([String(claim?.handler_email || "").trim(), ...settings.extraCc].filter((address) => EMAIL.test(address)))];
}

function estimatorFor(claimId: string): { id: string; name: string; email: string } | null {
  const chosen = engineerDispatchSettings().estimatorId || facts(claimId)?.handler_id || "";
  const row = get<{ id: string; name: string; email: string }>(`SELECT id, name, email FROM staff WHERE id = ? AND active = 1`, [chosen]);
  return row ? { id: String(row.id), name: String(row.name), email: String(row.email) } : null;
}

export function dispatchView(claimId: string, route: string): DispatchView {
  return {
    route,
    engineers: engineersFor(claimId),
    defaultEngineerId: defaultEngineerFor(claimId),
    handlerName: String(facts(claimId)?.handler_name || ""),
    cc: ccFor(claimId),
    estimator: estimatorFor(claimId),
    photos: vehiclePhotoIds(claimId).length,
    instructed: latestEvent(claimId, "engineer_instructed"),
    audatexSent: audatexRequest(claimId),
  };
}

/** One click: the instruction email with its PDF and the file's photos, the handler (and Settings' extras) copied in. */
export async function sendEngineerInstruction(input: { claimId: string; actorId: string; engineerId: string; sendWithoutPhotos: boolean }) {
  const gaps = instructionGaps(input.claimId, input.engineerId);
  const blocking = gaps.filter((gap) => gap.blocking);
  if (blocking.length) throw new Error(`Not sent. Missing: ${blocking.map((gap) => gap.label).join("; ")}.`);
  const photos = vehiclePhotoIds(input.claimId);
  if (!photos.length && !input.sendWithoutPhotos) throw new Error("There are no photos on the file. Tick \"Send without photos\" to send it anyway.");
  const engineer = getEngineer(input.engineerId)!;
  const content = instructionContent(input.claimId, input.engineerId);
  // The instruction is filed as a letter (the PDF attached to the email) and the engineer is kept on the file.
  run(`UPDATE claims SET engineer_id = ? WHERE id = ?`, [engineer.id, input.claimId]);
  const produced = generateClaimDocument({ claimId: input.claimId, templateKey: "engineer_instruction", actorId: input.actorId, recordOnFile: false });
  const cc = ccFor(input.claimId);
  const sent = await sendClaimEmail({
    claimId: input.claimId,
    actorId: input.actorId,
    to: engineer.email,
    cc,
    subject: content.subject,
    body: content.body,
    attachmentIds: [produced.documentId, ...photos],
  });
  if (!sent.ok) throw new Error(sent.error || "The instruction was not sent.");
  const when = nowUtcIso();
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "engineer_instructed",
    occurredAt: when,
    actorId: input.actorId,
    channel: "email",
    correspondenceId: sent.correspondenceId,
    documentId: produced.documentId,
    details: `Instruction sent to ${engineer.name} ${formatUkDateTime(when)}${cc.length ? `, copied to ${cc.join(", ")}` : ""}. ${photos.length} photo${photos.length === 1 ? "" : "s"} attached.${sent.status === "simulated_sent" ? " Simulated: the mailbox is not connected." : ""}`,
    source: "staff",
  });
  return { engineerName: engineer.name, simulated: sent.status === "simulated_sent", cc };
}

/** One click: the Audatex estimator gets a task due today and an email (the handler copied in). */
export async function sendToAudatexEstimator(input: { claimId: string; actorId: string }) {
  const claim = facts(input.claimId);
  if (!claim) throw new Error("File not found.");
  const estimator = estimatorFor(input.claimId);
  if (!estimator) throw new Error("Choose who prepares Audatex estimates in Settings → Engineers.");
  const title = `Prepare Audatex estimate – ${claim.file_reference}`;
  const today = londonTodayIso();
  run(
    `INSERT INTO tasks(id, claim_id, handler_id, title, details, type, due_at, status, created_at) VALUES (?, ?, ?, ?, ?, 'other', ?, 'open', ?)`,
    [newId("task"), input.claimId, estimator.id, title, `Asked from step 5 by the handler. Vehicle ${claim.registration || ""}.`, `${today}T17:00:00.000Z`, nowUtcIso()],
  );
  const cc = [String(claim.handler_email || "").trim()].filter((address) => EMAIL.test(address) && address !== estimator.email);
  let simulated = true;
  if (EMAIL.test(estimator.email)) {
    const sent = await sendClaimEmail({
      claimId: input.claimId,
      actorId: input.actorId,
      to: estimator.email,
      cc,
      subject: title,
      body: [`${estimator.name},`, "", `Please prepare the Audatex estimate for ${claim.file_reference} (${[claim.make, claim.model, claim.registration].filter(Boolean).join(" ")}).`, "", ...instructionAdditions(input.claimId).map((line) => `- ${line}`), "", `It is on your task list, due ${formatUkDate(today)}.`].join("\n"),
    });
    if (!sent.ok) throw new Error(sent.error || "The email to the estimator was not sent.");
    simulated = sent.status === "simulated_sent";
  }
  const when = nowUtcIso();
  recordClaimEvent({
    claimId: input.claimId,
    // Not the estimate itself (recorded when it is sent through Audatex): the request to the estimator.
    eventType: "other",
    occurredAt: when,
    actorId: input.actorId,
    details: `Sent to ${estimator.name} for the Audatex estimate ${formatUkDateTime(when)}: task "${title}" due ${formatUkDate(today)}${cc.length ? `, ${cc.join(", ")} copied in` : ""}.${simulated ? " Email simulated." : ""}`,
    source: "staff",
  });
  return { estimatorName: estimator.name, title };
}

