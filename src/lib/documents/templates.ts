import { formatUkDate } from "../dates";
import { CAS_LETTER_SPECS } from "./cas-wording";
import { isClientDraftKey } from "./client-drafts";
import {
  generateFaultOwnInsurerLetter,
  generateNonFaultTpInsurerLetter,
} from "./notification-letters";
import {
  emptyCorrespondenceFields,
  escapeHtml,
  generateFromSpec,
  wrapLetter,
  type CorrespondenceContext,
  type GeneratedLetter,
  type LetterContext,
} from "./correspondence";

export type { GeneratedLetter, LetterContext, CorrespondenceContext };

export const LETTER_TEMPLATES = [
  {
    key: "fault_own_insurer",
    title: "Fault claim letter (client's own insurer)",
    eventType: "initial_letter_own_insurer" as const,
    channel: "letter" as const,
  },
  {
    key: "initial_tp_insurer",
    title: "Non-fault initial letter (third-party insurer)",
    eventType: "initial_letter_tp_insurer" as const,
    channel: "letter" as const,
  },
  {
    key: "engineer_instruction",
    title: "Engineer instruction",
    eventType: "engineer_instructed" as const,
    channel: "letter" as const,
  },
  {
    key: "repair_commencement",
    title: "Repair commencement letter",
    eventType: "repairs_started" as const,
    channel: "letter" as const,
  },
  {
    key: "liability_chaser",
    title: "Liability chaser",
    eventType: "liability_chase_sent" as const,
    channel: "letter" as const,
  },
  {
    key: "hire_pack_cover",
    title: "Hire pack cover letter",
    eventType: "hire_pack_sent" as const,
    channel: "letter" as const,
  },
  {
    key: "rebuttal_rate",
    title: "Rebuttal — hire rate",
    eventType: "rebuttal_sent" as const,
    channel: "letter" as const,
  },
  {
    key: "rebuttal_need",
    title: "Rebuttal — need to hire",
    eventType: "rebuttal_sent" as const,
    channel: "letter" as const,
  },
  {
    key: "rebuttal_duration",
    title: "Rebuttal — hire duration",
    eventType: "rebuttal_sent" as const,
    channel: "letter" as const,
  },
  {
    key: "impecuniosity_disclosure",
    title: "Impecuniosity disclosure response",
    eventType: "rebuttal_sent" as const,
    channel: "letter" as const,
  },
  {
    key: "total_loss_cessation",
    title: "Total-loss cessation (third-party insurer)",
    eventType: "total_loss_cessation_sent" as const,
    channel: "letter" as const,
  },
  {
    key: "internal_chase",
    title: "Internal chase — repairer or engineer",
    eventType: "internal_chase_sent" as const,
    channel: "letter" as const,
  },
  // R64: the reviewer's drafts, waiting for Justin's approval. Generating one records nothing but the document.
  { key: "draft_client_authority", title: "Client instruction and authority (draft)", eventType: "document_generated" as const, channel: "letter" as const },
  { key: "draft_repair_authority", title: "Client repair authority (draft)", eventType: "document_generated" as const, channel: "letter" as const },
  { key: "draft_own_insurer_network", title: "Letter to the client's own insurer: claim reference and network code (draft)", eventType: "document_generated" as const, channel: "letter" as const },
  { key: "draft_own_insurer_notice", title: "Notification to the client's own insurer (draft)", eventType: "document_generated" as const, channel: "letter" as const },
  { key: "draft_split_tp", title: "Split liability: letter to the third-party insurer (draft)", eventType: "document_generated" as const, channel: "letter" as const },
  { key: "draft_split_client", title: "Split liability: explanation to the client (draft)", eventType: "document_generated" as const, channel: "letter" as const },
  { key: "draft_liability_position", title: "Liability disputed or not yet known: letter to the third-party insurer (draft)", eventType: "document_generated" as const, channel: "letter" as const },
  { key: "client_welcome_fault", title: "Client welcome, fault claim (draft)", eventType: "document_generated" as const, channel: "letter" as const },
  { key: "draft_tl_client", title: "Total loss: valuation to the client (draft)", eventType: "document_generated" as const, channel: "letter" as const },
  { key: "draft_tl_insurer", title: "Total loss: covering letter to the third-party insurer (draft)", eventType: "document_generated" as const, channel: "letter" as const },
] as const;

export type LetterTemplateKey = (typeof LETTER_TEMPLATES)[number]["key"];

export function isLetterTemplateKey(key: string): key is LetterTemplateKey {
  return LETTER_TEMPLATES.some((t) => t.key === key);
}

function asCorrespondence(ctx: LetterContext | CorrespondenceContext): CorrespondenceContext {
  return {
    ...emptyCorrespondenceFields(),
    clientDriverName: "",
    tpVehicleMake: "",
    tpVehicleModel: "",
    tpVehicleReg: "",
    tpPolicyNumber: "",
    tpHandlerName: "",
    tpInsurerAddress: "",
    ownInsurerAddress: "",
    lossesClaimed: "",
    creditHire: false,
    courtesyAllocated: false,
    ...ctx,
  };
}

function dateLine(iso: string | null | undefined, fallback = "not yet recorded on the file"): string {
  return iso ? formatUkDate(iso) : fallback;
}

function heading(ctx: LetterContext, extraRef?: string) {
  const policy = extraRef || ctx.tpPolicyOrClaimRef || ctx.ownPolicyRef || "Unknown";
  return `Our ref: ${ctx.fileReference}  Your policy: ${policy}`;
}

function operationalClose(ctx: LetterContext) {
  // R42: the operational-draft and template notes are shown on the screen above the sheet, never in the letter.
  return `<p>Yours faithfully</p><p>${escapeHtml(ctx.handlerName)}<br/>Complete Accident Solutions Ltd</p>`;
}

function generateRepairCommencement(ctx: LetterContext): GeneratedLetter {
  const missing = [];
  if (!ctx.clientName || ctx.clientName === "Unknown") missing.push("Client name");
  if (!ctx.accidentAt) missing.push("Accident date");
  if (!ctx.tpInsurer || ctx.tpInsurer === "Unknown") missing.push("Third-party insurer");
  if (!ctx.tpPolicyOrClaimRef || ctx.tpPolicyOrClaimRef === "Unknown") missing.push("Third-party insurer reference");
  if (!ctx.registration || ctx.registration === "Unknown") missing.push("Client registration");
  const letterDate = formatUkDate(ctx.letterDate);
  const accident = dateLine(ctx.accidentAt);
  const vehicle = `${ctx.make} ${ctx.model}`.trim() || "Unknown vehicle";
  const subject = heading(ctx, ctx.tpPolicyOrClaimRef);
  const notified = dateLine(ctx.dates.initial_letter_tp_insurer);
  const instructed = dateLine(ctx.dates.engineer_instructed);
  const started = dateLine(ctx.dates.repairs_started, formatUkDate(ctx.letterDate));
  const text = [
    "Dear Sir / Madam",
    "",
    subject,
    "",
    `We write to confirm that repairs to ${vehicle}, registration ${ctx.registration}, commenced on ${started}.`,
    `Accident: ${accident}. Initial notification to you: ${notified}. Engineer instructed: ${instructed}.`,
    "Please arrange payment of the repairs. This is not a letter before action.",
  ].join("\n");
  const html = wrapLetter(
    ctx,
    subject,
    `<p>Dear Sir / Madam</p>
<p>We write to confirm that repairs to ${escapeHtml(vehicle)}, registration <strong>${escapeHtml(ctx.registration)}</strong>, commenced on <strong>${started}</strong>.</p>
<p>Accident: <strong>${accident}</strong>. Initial notification: <strong>${notified}</strong>. Engineer instructed: <strong>${instructed}</strong>.</p>
<p>Please arrange payment of the repairs. This is not a letter before action.</p>
${operationalClose(ctx)}`,
    letterDate,
  );
  return {
    templateKey: "repair_commencement",
    title: "Repair commencement letter",
    subject,
    html,
    text,
    missing,
    legalSignOffRequired: false,
  };
}

function generateLiabilityChaser(ctx: LetterContext): GeneratedLetter {
  const missing = [];
  if (!ctx.clientName || ctx.clientName === "Unknown") missing.push("Client name");
  if (!ctx.accidentAt) missing.push("Accident date");
  if (!ctx.tpInsurer || ctx.tpInsurer === "Unknown") missing.push("Third-party insurer");
  if (!ctx.tpPolicyOrClaimRef || ctx.tpPolicyOrClaimRef === "Unknown") missing.push("Third-party insurer reference");
  if (!ctx.registration || ctx.registration === "Unknown") missing.push("Client registration");
  const letterDate = formatUkDate(ctx.letterDate);
  const accident = dateLine(ctx.accidentAt);
  const lastLetter = dateLine(ctx.dates.initial_letter_tp_insurer);
  const subject = heading(ctx);
  const text = [
    "Dear Sir / Madam",
    "",
    subject,
    "",
    ...(ctx.chaseHistory ? [ctx.chaseHistory, ""] : []),
    `We refer to our letter of ${lastLetter} regarding ${ctx.clientName} and the accident on ${accident}.`,
    "We should be grateful for your liability response. Please ignore this if you have already replied.",
  ].join("\n");
  const html = wrapLetter(
    ctx,
    subject,
    `<p>Dear Sir / Madam</p>
${ctx.chaseHistory ? `<p>${escapeHtml(ctx.chaseHistory)}</p>\n` : ""}<p>We refer to our letter of <strong>${lastLetter}</strong> regarding ${escapeHtml(ctx.clientName)} and the accident on <strong>${accident}</strong>.</p>
<p>We should be grateful for your liability response. Please ignore this if you have already replied.</p>
${operationalClose(ctx)}`,
    letterDate,
  );
  return {
    templateKey: "liability_chaser",
    title: "Liability chaser",
    subject,
    html,
    text,
    missing,
    legalSignOffRequired: false,
  };
}

export function generateLetter(templateKey: LetterTemplateKey, ctx: LetterContext | CorrespondenceContext): GeneratedLetter {
  // The drafts need the file's extras and Justin's approval; they are made where the file is read (chronology).
  if (isClientDraftKey(templateKey)) throw new Error("This draft is produced from the claim file.");
  if (templateKey === "fault_own_insurer") return generateFaultOwnInsurerLetter(ctx);
  if (templateKey === "initial_tp_insurer") return generateNonFaultTpInsurerLetter(ctx);
  if (templateKey === "repair_commencement") return generateRepairCommencement(ctx);
  if (templateKey === "liability_chaser") return generateLiabilityChaser(ctx);
  const spec = CAS_LETTER_SPECS.find((item) => item.key === templateKey);
  if (!spec) throw new Error(`Unknown letter template: ${templateKey}`);
  return generateFromSpec(spec, asCorrespondence(ctx));
}

export { eventLabel } from "../domain/events";
