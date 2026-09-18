import { formatUkDate, formatUkTime } from "../dates";
import { CAS_LETTER_SPECS } from "./cas-wording";
import {
  CAS_TEMPLATE_NOTICE,
  OPERATIONAL_DRAFT_NOTICE,
  emptyCorrespondenceFields,
  escapeHtml,
  generateFromSpec,
  handlerInitials,
  namesDiffer,
  wrapLetter,
  type CorrespondenceContext,
  type GeneratedLetter,
  type LetterContext,
} from "./correspondence";

export type { GeneratedLetter, LetterContext, CorrespondenceContext };

export const LETTER_TEMPLATES = [
  {
    key: "initial_tp_insurer",
    title: "Notification of claim (third-party insurer)",
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
    lossesClaimed: "",
    creditHire: false,
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
  return `<p>Yours faithfully</p><p>${escapeHtml(ctx.handlerName)}<br/>Complete Accident Solutions Ltd</p>
<p class="text-xs">${escapeHtml(OPERATIONAL_DRAFT_NOTICE)}</p>
<p class="text-xs">${escapeHtml(CAS_TEMPLATE_NOTICE)}</p>`;
}

function generateInitialTpInsurer(ctx: LetterContext | CorrespondenceContext): GeneratedLetter {
  const full = asCorrespondence(ctx);
  const missing: string[] = [];
  if (!full.clientName || full.clientName === "Unknown") missing.push("Client name");
  if (!full.accidentAt) missing.push("Accident date");
  if (!full.tpInsurer || full.tpInsurer === "Unknown") missing.push("Third-party insurer");
  if (!full.registration || full.registration === "Unknown") missing.push("Client registration");
  if (!full.tpPolicyNumber || full.tpPolicyNumber === "Unknown") missing.push("Third-party policy number");
  const letterDate = formatUkDate(full.letterDate);
  const initials = handlerInitials(full.handlerName);
  const ourRef = `${full.fileReference}/${initials}/${full.handlerName}`;
  const ownVehicle = [full.make, full.model, full.registration].filter(Boolean).join(" ").trim() || "Unknown";
  const theirVehicle = [full.tpVehicleMake, full.tpVehicleModel, full.tpVehicleReg].filter(Boolean).join(" ").trim() || "Unknown";
  const accidentWhen = full.accidentAt
    ? `${formatUkDate(full.accidentAt)} at ${formatUkTime(full.accidentAt)}`
    : "Unknown";
  const accidentWhere = full.accidentLocation && full.accidentLocation !== "Unknown" ? full.accidentLocation : "Unknown";
  const showDriver = namesDiffer(full.clientDriverName || "", full.clientName);
  const losses = (full.lossesClaimed || "").trim() || "uninsured losses";
  const subject = `Uninsured losses — ${full.fileReference}`;
  const facts = [
    `Policy Number: ${full.tpPolicyNumber || "Unknown"}`,
    `Our Client: ${full.clientName}`,
    ...(showDriver ? [`Client's driver: ${full.clientDriverName}`] : []),
    `Our Insured's Vehicle: ${ownVehicle}`,
    `Their Insured's Vehicle: ${theirVehicle}`,
    `Date, time and location of Accident: ${accidentWhen} at ${accidentWhere}`,
  ];
  const text = [
    `Our Reference: ${ourRef}`,
    "",
    ...facts,
    "",
    "Dear Sir / Madam",
    "",
    `We act on behalf of ${full.clientName} in respect of uninsured losses arising from the above road traffic accident.`,
    "",
    "Accordingly, we place you on notice of our client's claim.",
    "",
    `Our client's claim includes ${losses}. Supporting documentation follows by covering email.`,
    "",
    "We should be grateful if you would please:",
    "",
    "1. Provide your claim reference",
    "2. Confirm that you are the correct insurer / handler",
    "3. Confirm that indemnity is in place",
    "4. Confirm your position on liability",
    "",
    "All future correspondence regarding this matter should be directed to ourselves.",
    "",
    "Yours faithfully",
    "",
    full.handlerName,
    full.senderTitle,
    "Complete Accident Solutions Ltd",
  ].join("\n");
  const driverRow = showDriver
    ? `<p>Client's driver: ${escapeHtml(full.clientDriverName || "")}</p>\n`
    : "";
  const html = wrapLetter(
    full,
    subject,
    `<p>Our Reference: <strong>${escapeHtml(ourRef)}</strong></p>
<p>Policy Number: ${escapeHtml(full.tpPolicyNumber || "Unknown")}</p>
<p>Our Client: ${escapeHtml(full.clientName)}</p>
${driverRow}<p>Our Insured's Vehicle: ${escapeHtml(ownVehicle)}</p>
<p>Their Insured's Vehicle: ${escapeHtml(theirVehicle)}</p>
<p>Date, time and location of Accident: ${escapeHtml(accidentWhen)} at ${escapeHtml(accidentWhere)}</p>
<p>Dear Sir / Madam</p>
<p>We act on behalf of ${escapeHtml(full.clientName)} in respect of uninsured losses arising from the above road traffic accident.</p>
<p>Accordingly, we place you on notice of our client's claim.</p>
<p>Our client's claim includes ${escapeHtml(losses)}. Supporting documentation follows by covering email.</p>
<p>We should be grateful if you would please:</p>
<ol>
<li>Provide your claim reference</li>
<li>Confirm that you are the correct insurer / handler</li>
<li>Confirm that indemnity is in place</li>
<li>Confirm your position on liability</li>
</ol>
<p>All future correspondence regarding this matter should be directed to ourselves.</p>
<p>Yours faithfully</p>
<p>${escapeHtml(full.handlerName)}<br/>${escapeHtml(full.senderTitle)}<br/>Complete Accident Solutions Ltd</p>
<p class="text-xs">${escapeHtml(CAS_TEMPLATE_NOTICE)}</p>`,
    letterDate,
  );
  return {
    templateKey: "initial_tp_insurer",
    title: "Notification of claim (third-party insurer)",
    subject,
    html,
    text: `${text}\n\n${CAS_TEMPLATE_NOTICE}`,
    missing,
    legalSignOffRequired: false,
  };
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
    text: `${text}\n\n${OPERATIONAL_DRAFT_NOTICE}`,
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
    `We refer to our letter of ${lastLetter} regarding ${ctx.clientName} and the accident on ${accident}.`,
    "We should be grateful for your liability response. Please ignore this if you have already replied.",
  ].join("\n");
  const html = wrapLetter(
    ctx,
    subject,
    `<p>Dear Sir / Madam</p>
<p>We refer to our letter of <strong>${lastLetter}</strong> regarding ${escapeHtml(ctx.clientName)} and the accident on <strong>${accident}</strong>.</p>
<p>We should be grateful for your liability response. Please ignore this if you have already replied.</p>
${operationalClose(ctx)}`,
    letterDate,
  );
  return {
    templateKey: "liability_chaser",
    title: "Liability chaser",
    subject,
    html,
    text: `${text}\n\n${OPERATIONAL_DRAFT_NOTICE}`,
    missing,
    legalSignOffRequired: false,
  };
}

export function generateLetter(templateKey: LetterTemplateKey, ctx: LetterContext | CorrespondenceContext): GeneratedLetter {
  if (templateKey === "initial_tp_insurer") return generateInitialTpInsurer(ctx);
  if (templateKey === "repair_commencement") return generateRepairCommencement(ctx);
  if (templateKey === "liability_chaser") return generateLiabilityChaser(ctx);
  const spec = CAS_LETTER_SPECS.find((item) => item.key === templateKey);
  if (!spec) throw new Error(`Unknown letter template: ${templateKey}`);
  return generateFromSpec(spec, asCorrespondence(ctx));
}

export { eventLabel } from "../domain/events";
