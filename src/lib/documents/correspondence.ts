import { formatUkDate } from "../dates";
import { CAS_CLAIMS_MAILBOX } from "../constants";
import { CAS_COMPANY } from "./cas-hire-terms";
import type { ChronologyDateMap } from "../domain/events";
import type { ClaimEventType } from "../domain/events";
import { formatGbp } from "../money";

export const CAS_TEMPLATE_NOTICE =
  "Wording is taken from CAS's supplied letter and email templates. It is not a signed original. Live sending is not connected.";

export const CAS_LEGAL_SIGNOFF_NOTICE =
  "This template includes supplied UK credit hire case-law citations. Legal wording needs solicitor sign-off before it is used live. This is not a letter before action.";

export const OPERATIONAL_DRAFT_NOTICE =
  "Operational draft (not one of the CAS supplied templates). No legal threat is included. This is not a letter before action.";

export type LetterContext = {
  fileReference: string;
  clientName: string;
  handlerName: string;
  accidentAt: string | null;
  accidentLocation: string;
  circumstances: string;
  registration: string;
  make: string;
  model: string;
  tpInsurer: string;
  tpPolicyOrClaimRef: string;
  ownInsurer: string;
  ownPolicyRef: string;
  dates: ChronologyDateMap;
  letterDate: string;
  /** Shown only when the driver is not the client (company vehicle, owner not driving). */
  clientDriverName?: string;
  tpVehicleMake?: string;
  tpVehicleModel?: string;
  tpVehicleReg?: string;
  tpPolicyNumber?: string;
  tpHandlerName?: string;
  tpInsurerAddress?: string;
  ownInsurerAddress?: string;
  lossesClaimed?: string;
  creditHire?: boolean;
  courtesyAllocated?: boolean;
};

export type CorrespondenceContext = LetterContext & {
  senderTitle: string;
  clientEmail: string;
  tpInsuredName: string;
  tpEmail: string;
  engineerName: string;
  engineerAddress: string;
  engineerEmail: string;
  vehicleLocation: string;
  siteContactName: string;
  siteContactPhone: string;
  reportTurnaroundDays: string;
  hireStartAt: string | null;
  hireEndAt: string | null;
  dailyRatePence: number | null;
  totalHireDays: number | null;
  totalHireChargePence: number | null;
  repairCostPence: number | null;
  invoiceRef: string;
  settlementAmountPence: number | null;
  settlementDate: string | null;
  dueDate: string | null;
  finalDueDate: string | null;
  needSummary: string;
  needEvidenceSummary: string;
  mitigationStepsSummary: string;
  bhrEvidenceSource: string;
  theirLetterDate: string | null;
  theirObjectionSummary: string;
  disclosureDocumentsSummary: string;
  disclosureResponse: string;
  hireCessationDate: string | null;
  cessationBasis: string;
  ownershipOrFinanceNextSteps: string;
  currentStageLabel: string;
  stageSpecificDetail: string;
  readyDate: string | null;
  collectionLocation: string;
  collectionOrDeliveryInstructions: string;
  overdueItem: string;
  originalDueDate: string | null;
  recipientName: string;
  closingSummary: string;
  finalSettlementAmountPence: number | null;
  outstandingBalancePence: number | null;
};

export type GeneratedLetter = {
  templateKey: string;
  title: string;
  subject: string;
  html: string;
  text: string;
  missing: string[];
  legalSignOffRequired: boolean;
};

export type CorrespondenceAudience = "client" | "insurer" | "internal" | "engineer";
export type CorrespondenceChannel = "letter" | "email";

export type CorrespondenceSpec = {
  key: string;
  title: string;
  channel: CorrespondenceChannel;
  audience: CorrespondenceAudience;
  eventType: ClaimEventType;
  legalCitations: boolean;
  required: readonly string[];
  subject: string;
  body: string;
};

const VAR_LABELS: Record<string, string> = {
  client_name: "Client name",
  accident_date: "Accident date",
  vehicle_reg: "Client registration",
  vehicle_make_model: "Vehicle make and model",
  tp_insurer_name: "Third-party insurer",
  tp_claim_ref: "Third-party insurer reference",
  tp_insured_name: "Third-party insured name",
  engineer_name: "Engineer name",
  engineer_address: "Engineer address",
  vehicle_location: "Vehicle location",
  site_contact_name: "Site contact name",
  site_contact_phone: "Site contact telephone",
  report_turnaround_days: "Report turnaround (days)",
  hire_start_date: "Hire start date",
  hire_end_date: "Hire end date",
  daily_rate: "Daily hire rate",
  total_hire_days: "Total hire days",
  total_hire_charge: "Total hire charge",
  repair_cost: "Repair cost",
  invoice_ref: "Repair invoice reference",
  settlement_amount: "Settlement amount",
  settlement_date: "Settlement date",
  due_date: "Payment due date",
  final_due_date: "Final response date",
  total_claim_amount: "Total claim amount",
  outstanding_balance: "Outstanding balance",
  need_summary: "Need for hire",
  need_evidence_summary: "Need evidence",
  mitigation_steps_summary: "Mitigation steps",
  bhr_evidence_source: "Basic hire rate evidence source",
  their_letter_date: "Insurer's letter date",
  their_objection_summary: "Insurer's objection",
  disclosure_documents_summary: "Financial disclosure documents",
  disclosure_response_option_a_or_b: "Disclosure response",
  hire_cessation_date: "Hire cessation date",
  cessation_basis: "Cessation basis",
  ownership_or_finance_next_steps: "Ownership or finance next steps",
  current_stage_label: "Current stage",
  stage_specific_detail: "Stage detail",
  ready_date: "Vehicle ready date",
  collection_location: "Collection location",
  collection_or_delivery_instructions: "Collection or delivery instructions",
  overdue_item: "Overdue item",
  original_due_date: "Original due date",
  recipient_name: "Recipient name",
  closing_summary: "Closing summary",
  final_settlement_amount: "Final settlement amount",
  hire_pack_sent_date: "Hire pack sent date",
  chase_1_date: "Payment chase 1 date",
  notification_date: "Initial notification date",
  engineer_instructed_date: "Engineer instructed date",
  report_date: "Engineer report date",
  repair_authorised_date: "Repair authorised date",
  repair_completed_date: "Repair completed date",
  client_email: "Client email",
};

export function handlerInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part && !/^(ltd|limited|and|&)$/i.test(part));
  if (parts.length === 0) return "Unknown";
  return parts.map((part) => part[0]!.toUpperCase()).join("");
}

export function namesDiffer(a: string, b: string): boolean {
  const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  if (!norm(a) || norm(a) === "unknown") return false;
  return norm(a) !== norm(b);
}

export const NOT_YET_ON_FILE = "[not yet on file]";

export function isBlankClaimValue(value: string | null | undefined): boolean {
  const trimmed = (value || "").trim();
  return !trimmed || trimmed.toLowerCase() === "unknown";
}

export function claimValueOrGap(value: string | null | undefined, label: string, missing: string[]): string {
  if (isBlankClaimValue(value)) {
    if (!missing.includes(label)) missing.push(label);
    return NOT_YET_ON_FILE;
  }
  return String(value).trim();
}

export function markGapHtml(value: string): string {
  if (value === NOT_YET_ON_FILE) return `<span class="missing-field">${escapeHtml(value)}</span>`;
  return escapeHtml(value).replaceAll("\n", "<br/>\n");
}

export function joinEnglishList(parts: string[]): string {
  if (parts.length === 0) return "uninsured losses";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const LOSS_PHRASES: Record<string, string> = {
  repairs: "vehicle repair charges",
  vehicle_damage: "vehicle repair charges",
  hire: "hire charges",
  credit_hire: "credit hire charges",
  courtesy: "courtesy vehicle charges",
  recovery: "recovery charges",
  storage: "storage charges",
  gate_fee: "gate fee",
  cdw: "collision damage waiver",
  additional_driver: "additional driver charges",
  delivery_collection: "delivery and collection charges",
  engineers_fees: "engineer's fees",
  salvage_shortfall: "salvage shortfall",
  other: "other uninsured losses",
};

export function summariseLossesClaimed(
  lines: Array<{ head_of_loss: string; claimed_pence: number }>,
  creditHire: boolean,
): string {
  const claimed = lines.filter((line) => (line.claimed_pence || 0) > 0);
  const phrases: string[] = [];
  const has = (head: string) => claimed.some((line) => line.head_of_loss === head);
  if (has("repairs") || has("vehicle_damage")) phrases.push(LOSS_PHRASES.repairs!);
  if (has("credit_hire") || (creditHire && has("hire"))) phrases.push(LOSS_PHRASES.credit_hire!);
  else if (has("hire")) phrases.push(LOSS_PHRASES.hire!);
  const ordered = ["courtesy", "recovery", "storage", "gate_fee", "cdw", "additional_driver", "delivery_collection", "engineers_fees", "salvage_shortfall", "other"];
  for (const head of ordered) {
    if (has(head)) phrases.push(LOSS_PHRASES[head]!);
  }
  const used = new Set(["repairs", "vehicle_damage", "hire", "credit_hire", ...ordered]);
  for (const line of claimed) {
    if (!used.has(line.head_of_loss)) {
      phrases.push(`${line.head_of_loss.replaceAll("_", " ")} charges`);
    }
  }
  return joinEnglishList(phrases);
}

export function fillPlaceholders(source: string, vars: Record<string, string>): string {
  return source.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key: string) => vars[key] ?? "Unknown");
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function bodyToHtml(text: string): string {
  const withBold = escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  return withBold
    .split(/\n\n+/)
    .map((para) => `<p>${para.split("\n").join("<br/>\n")}</p>`)
    .join("\n");
}

export function wrapLetter(
  ctx: LetterContext,
  subject: string,
  body: string,
  letterDate: string,
  addressee?: { name?: string; address?: string },
) {
  const addresseeName = (addressee?.name || "").trim();
  const addresseeAddress = (addressee?.address || "").trim();
  const addresseeHtml =
    addresseeName && addresseeName !== "Unknown"
      ? `<p>${escapeHtml(addresseeName)}${
          addresseeAddress && addresseeAddress !== "Unknown"
            ? `<br/>${escapeHtml(addresseeAddress).replaceAll("\n", "<br/>")}`
            : ""
        }</p>`
      : "";
  return `<article class="letter">
<header>
<p><strong>${escapeHtml(CAS_COMPANY.name)}</strong></p>
<p>${escapeHtml(CAS_COMPANY.address)}</p>
<p>${letterDate}</p>
${addresseeHtml}
<p>${escapeHtml(subject)}</p>
</header>
${body}
</article>`;
}

function moneyOrUnknown(pence: number | null | undefined): string {
  if (pence === null || pence === undefined || pence <= 0) return "Unknown";
  return formatGbp(pence);
}

function dateOrUnknown(iso: string | null | undefined): string {
  if (!iso) return "Unknown";
  return formatUkDate(iso);
}

function textOrUnknown(value: string | null | undefined): string {
  const trimmed = (value || "").trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") return "Unknown";
  return trimmed;
}

function daysOrUnknown(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "Unknown";
  return String(value);
}

export function correspondenceVars(ctx: CorrespondenceContext): Record<string, string> {
  const vehicle = `${ctx.make} ${ctx.model}`.trim() || "Unknown";
  const hireCharge =
    ctx.totalHireChargePence && ctx.totalHireChargePence > 0
      ? ctx.totalHireChargePence
      : ctx.totalHireDays && ctx.dailyRatePence
        ? ctx.totalHireDays * ctx.dailyRatePence
        : null;
  const repair = ctx.repairCostPence && ctx.repairCostPence > 0 ? ctx.repairCostPence : null;
  const totalClaim =
    hireCharge && repair ? hireCharge + repair : hireCharge || repair || ctx.outstandingBalancePence || null;
  return {
    company_name: CAS_COMPANY.name,
    sender_name: textOrUnknown(ctx.handlerName) === "Unknown" ? CAS_COMPANY.name : ctx.handlerName,
    sender_title: textOrUnknown(ctx.senderTitle),
    company_address: CAS_COMPANY.address,
    company_email: CAS_CLAIMS_MAILBOX,
    company_phone: CAS_COMPANY.phone,
    claim_ref: ctx.fileReference,
    client_name: textOrUnknown(ctx.clientName),
    client_email: textOrUnknown(ctx.clientEmail),
    vehicle_reg: textOrUnknown(ctx.registration),
    vehicle_make_model: vehicle === "Unknown" ? "Unknown" : vehicle,
    accident_date: dateOrUnknown(ctx.accidentAt),
    tp_insurer_name: textOrUnknown(ctx.tpInsurer),
    tp_claim_ref: textOrUnknown(ctx.tpPolicyOrClaimRef),
    tp_insured_name: textOrUnknown(ctx.tpInsuredName),
    engineer_name: textOrUnknown(ctx.engineerName),
    engineer_address: textOrUnknown(ctx.engineerAddress),
    vehicle_location: textOrUnknown(ctx.vehicleLocation),
    site_contact_name: textOrUnknown(ctx.siteContactName),
    site_contact_phone: textOrUnknown(ctx.siteContactPhone),
    report_turnaround_days: textOrUnknown(ctx.reportTurnaroundDays),
    hire_start_date: dateOrUnknown(ctx.hireStartAt),
    hire_end_date: dateOrUnknown(ctx.hireEndAt),
    daily_rate: moneyOrUnknown(ctx.dailyRatePence),
    total_hire_days: daysOrUnknown(ctx.totalHireDays),
    total_hire_charge: moneyOrUnknown(hireCharge),
    repair_cost: moneyOrUnknown(repair),
    invoice_ref: textOrUnknown(ctx.invoiceRef),
    settlement_amount: moneyOrUnknown(ctx.settlementAmountPence),
    settlement_date: dateOrUnknown(ctx.settlementDate),
    due_date: textOrUnknown(ctx.dueDate),
    final_due_date: textOrUnknown(ctx.finalDueDate),
    total_claim_amount: moneyOrUnknown(totalClaim),
    outstanding_balance: moneyOrUnknown(ctx.outstandingBalancePence ?? totalClaim),
    need_summary: textOrUnknown(ctx.needSummary),
    need_evidence_summary: textOrUnknown(ctx.needEvidenceSummary),
    mitigation_steps_summary: textOrUnknown(ctx.mitigationStepsSummary),
    bhr_evidence_source: textOrUnknown(ctx.bhrEvidenceSource),
    their_letter_date: dateOrUnknown(ctx.theirLetterDate),
    their_objection_summary: textOrUnknown(ctx.theirObjectionSummary),
    disclosure_documents_summary: textOrUnknown(ctx.disclosureDocumentsSummary),
    disclosure_response_option_a_or_b: textOrUnknown(ctx.disclosureResponse),
    hire_cessation_date: dateOrUnknown(ctx.hireCessationDate),
    cessation_basis: textOrUnknown(ctx.cessationBasis),
    ownership_or_finance_next_steps: textOrUnknown(ctx.ownershipOrFinanceNextSteps),
    current_stage_label: textOrUnknown(ctx.currentStageLabel),
    stage_specific_detail: textOrUnknown(ctx.stageSpecificDetail),
    ready_date: dateOrUnknown(ctx.readyDate),
    collection_location: textOrUnknown(ctx.collectionLocation),
    collection_or_delivery_instructions: textOrUnknown(ctx.collectionOrDeliveryInstructions),
    overdue_item: textOrUnknown(ctx.overdueItem),
    original_due_date: dateOrUnknown(ctx.originalDueDate),
    recipient_name: textOrUnknown(ctx.recipientName),
    closing_summary: textOrUnknown(ctx.closingSummary),
    final_settlement_amount: moneyOrUnknown(ctx.finalSettlementAmountPence),
    hire_pack_sent_date: dateOrUnknown(ctx.dates.hire_pack_sent || null),
    chase_1_date: dateOrUnknown(ctx.dates.payment_chase_1_sent || null),
    notification_date: dateOrUnknown(ctx.dates.initial_letter_tp_insurer || null),
    engineer_instructed_date: dateOrUnknown(ctx.dates.engineer_instructed || null),
    report_date: dateOrUnknown(ctx.dates.engineer_report_received || null),
    repair_authorised_date: dateOrUnknown(ctx.dates.repairs_authorised || null),
    repair_completed_date: dateOrUnknown(ctx.dates.repairs_complete || ctx.dates.vehicle_returned || null),
    our_reference: `${ctx.fileReference}/${handlerInitials(ctx.handlerName)}/${textOrUnknown(ctx.handlerName)}`,
    client_driver_name: textOrUnknown(ctx.clientDriverName),
    tp_vehicle: [ctx.tpVehicleMake, ctx.tpVehicleModel, ctx.tpVehicleReg].filter(Boolean).join(" ").trim() || "Unknown",
    tp_policy_number: textOrUnknown(ctx.tpPolicyNumber),
    losses_claimed: textOrUnknown(ctx.lossesClaimed),
  };
}

export function missingFromSpec(required: readonly string[], vars: Record<string, string>): string[] {
  const missing: string[] = [];
  for (const key of required) {
    const value = vars[key];
    if (!value || value === "Unknown" || value === "Unknown vehicle") {
      missing.push(VAR_LABELS[key] || key.replaceAll("_", " "));
    }
  }
  return missing;
}

function noticesFor(spec: CorrespondenceSpec): { html: string; text: string } {
  const lines = [CAS_TEMPLATE_NOTICE];
  if (spec.legalCitations) lines.push(CAS_LEGAL_SIGNOFF_NOTICE);
  return {
    html: lines.map((line) => `<p class="text-xs">${escapeHtml(line)}</p>`).join("\n"),
    text: `\n\n${lines.join("\n")}`,
  };
}

export function generateFromSpec(spec: CorrespondenceSpec, ctx: CorrespondenceContext): GeneratedLetter {
  const vars = correspondenceVars(ctx);
  const missing = missingFromSpec(spec.required, vars);
  const subject = fillPlaceholders(spec.subject, vars);
  const body = fillPlaceholders(spec.body, vars);
  const letterDate = formatUkDate(ctx.letterDate);
  const notice = noticesFor(spec);
  const addressee =
    spec.audience === "engineer"
      ? {
          name: textOrUnknown(ctx.engineerName) === "Unknown" ? "" : ctx.engineerName,
          address: textOrUnknown(ctx.engineerAddress) === "Unknown" ? "" : ctx.engineerAddress,
        }
      : undefined;
  const addressBlock =
    addressee?.name
      ? `${addressee.name}${addressee.address ? `\n${addressee.address}` : ""}\n\n`
      : "";
  const html = wrapLetter(ctx, subject, `${bodyToHtml(body)}\n${notice.html}`, letterDate, addressee);
  return {
    templateKey: spec.key,
    title: spec.title,
    subject,
    html,
    text: `${addressBlock}${body}${notice.text}`,
    missing,
    legalSignOffRequired: spec.legalCitations,
  };
}

export function recipientFor(audience: CorrespondenceAudience, ctx: CorrespondenceContext): string {
  if (audience === "client") return textOrUnknown(ctx.clientEmail) === "Unknown" ? "" : ctx.clientEmail;
  if (audience === "insurer") return textOrUnknown(ctx.tpEmail) === "Unknown" ? "" : ctx.tpEmail;
  if (audience === "engineer") return textOrUnknown(ctx.engineerEmail) === "Unknown" ? "" : ctx.engineerEmail;
  return CAS_COMPANY.email;
}

export function emptyCorrespondenceFields(): Omit<CorrespondenceContext, keyof LetterContext> {
  return {
    senderTitle: "Claims handler",
    clientEmail: "",
    tpInsuredName: "",
    tpEmail: "",
    engineerName: "",
    engineerAddress: "",
    engineerEmail: "",
    vehicleLocation: "",
    siteContactName: "",
    siteContactPhone: "",
    reportTurnaroundDays: "",
    hireStartAt: null,
    hireEndAt: null,
    dailyRatePence: null,
    totalHireDays: null,
    totalHireChargePence: null,
    repairCostPence: null,
    invoiceRef: "",
    settlementAmountPence: null,
    settlementDate: null,
    dueDate: null,
    finalDueDate: null,
    needSummary: "",
    needEvidenceSummary: "",
    mitigationStepsSummary: "",
    bhrEvidenceSource: "",
    theirLetterDate: null,
    theirObjectionSummary: "",
    disclosureDocumentsSummary: "",
    disclosureResponse: "",
    hireCessationDate: null,
    cessationBasis: "",
    ownershipOrFinanceNextSteps: "",
    currentStageLabel: "",
    stageSpecificDetail: "",
    readyDate: null,
    collectionLocation: "",
    collectionOrDeliveryInstructions: "",
    overdueItem: "",
    originalDueDate: null,
    recipientName: "",
    closingSummary: "",
    finalSettlementAmountPence: null,
    outstandingBalancePence: null,
  };
}
