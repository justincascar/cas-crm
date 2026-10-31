import { formatUkDate, formatUkTime } from "../dates";
import { formatGbp } from "../money";
import { CAS_COMPANY } from "./cas-hire-terms";
import {
  claimValueOrGap,
  escapeHtml,
  isBlankClaimValue,
  markGapHtml,
  wrapLetter,
  type CorrespondenceContext,
  type GeneratedLetter,
} from "./correspondence";
import { DRAFT_WORDING_NOT_APPROVED } from "./template-approval";

/**
 * R64: the reviewer's first drafts of CAS's client and insurer documents (docs/correspondence-templates/drafts/
 * CAS-document-drafts-31oct2026.md), word for word. None is approved. Each is "Waiting for Justin's approval" and is
 * marked as a draft on the page until he approves it in Settings; Drafts 1, 2, 4 and 5 also need the solicitor's check.
 * Words in [square brackets] in the drafts are filled from the file; a value not on the file shows as a gap.
 */

export type ClientDraftKey =
  | "draft_client_authority"
  | "draft_repair_authority"
  | "draft_own_insurer_network"
  | "draft_own_insurer_notice"
  | "draft_split_tp"
  | "draft_split_client"
  | "draft_liability_position"
  | "draft_courtesy_car"
  | "client_welcome_fault"
  | "draft_tl_client"
  | "draft_tl_insurer";

export type ClientDraftInfo = {
  key: ClientDraftKey;
  /** "Draft 1" and so on, as the drafts file numbers them. */
  number: string;
  title: string;
  recipient: "client" | "own_insurer" | "tp_insurer";
  /** Needs the solicitor's check recorded on the approval as well as Justin's. */
  solicitor: boolean;
  /** Signed by the client like the hire agreement (on screen or on paper). */
  signed: boolean;
  /** The clause whose tick must be ticked to sign. */
  tickClause?: string;
  /** An outline only: nothing is generated until CAS's wording is in Settings. */
  outlineOnly?: boolean;
  /** The step event recorded when it is sent or marked sent. */
  sentEvent?: "initial_letter_tp_insurer" | "initial_letter_own_insurer" | "client_welcome_sent";
};

export const CLIENT_DRAFTS: ClientDraftInfo[] = [
  { key: "draft_client_authority", number: "Draft 1", title: "Client instruction and authority", recipient: "client", solicitor: true, signed: true, tickClause: "10" },
  { key: "draft_repair_authority", number: "Draft 2", title: "Client repair authority", recipient: "client", solicitor: true, signed: true, tickClause: "9" },
  { key: "draft_own_insurer_network", number: "Draft 3", title: "Letter to the client's own insurer (claim reference and network code)", recipient: "own_insurer", solicitor: false, signed: false, sentEvent: "initial_letter_own_insurer" },
  { key: "draft_own_insurer_notice", number: "Draft 4", title: "Notification to the client's own insurer", recipient: "own_insurer", solicitor: true, signed: false },
  { key: "draft_split_tp", number: "Draft 5a", title: "Split liability: letter to the third-party insurer", recipient: "tp_insurer", solicitor: true, signed: false, sentEvent: "initial_letter_tp_insurer" },
  { key: "draft_split_client", number: "Draft 5b", title: "Split liability: explanation to the client", recipient: "client", solicitor: true, signed: false },
  { key: "draft_liability_position", number: "Draft 6", title: "Liability disputed or not yet known: letter to the third-party insurer", recipient: "tp_insurer", solicitor: false, signed: false, sentEvent: "initial_letter_tp_insurer" },
  { key: "draft_courtesy_car", number: "Draft 7", title: "Courtesy car agreement", recipient: "client", solicitor: true, signed: true, outlineOnly: true },
  { key: "client_welcome_fault", number: "Fault welcome", title: "Client welcome (fault claim)", recipient: "client", solicitor: false, signed: false, sentEvent: "client_welcome_sent" },
  // R66: total loss, steps 7 and 8. The client answers A, B or C on 8a; 8b goes to the third-party insurer.
  { key: "draft_tl_client", number: "Draft 8a", title: "Total loss: valuation to the client (with reply form)", recipient: "client", solicitor: true, signed: true },
  { key: "draft_tl_insurer", number: "Draft 8b", title: "Total loss: covering letter to the third-party insurer", recipient: "tp_insurer", solicitor: true, signed: false },
];

export function clientDraftInfo(key: string): ClientDraftInfo | undefined {
  return CLIENT_DRAFTS.find((item) => item.key === key);
}

export function isClientDraftKey(key: string | null | undefined): key is ClientDraftKey {
  return Boolean(key && CLIENT_DRAFTS.some((item) => item.key === key));
}

/** What the drafts need beyond the usual letter context. */
export type ClientDraftExtras = {
  clientAddress: string;
  ownInsurerClaimRef: string;
  ownExcessPence: number | null;
  /** On a Split file, the third party's share of liability (1–99), or null when not yet known. */
  splitTpPercent: number | null;
  /** The latest MID search on the file, or null: the MID sentence is then left out. */
  mid: { searchedOn: string; registration: string; insurer: string; policy: string; found: boolean } | null;
  /** Draft 6: the one-line account, typed or checked by the handler. Never generated. */
  accountLine: string;
  /** Draft 3: photographs are attached to the email. */
  photosAttached: boolean;
  /** R66 Drafts 8a and 8b: the engineer's total-loss figures and the client's answer, as recorded on the file. */
  totalLoss?: {
    engineerName: string;
    inspectionDate: string;
    pavPence: number | null;
    salvageCategory: string;
    salvagePence: number | null;
    amountRequestedPence: number | null;
    /** "release" (A), "keep" (B), or "" before the client answers. */
    clientChoice: "release" | "keep" | "";
    vehicleLocation: string;
    financeLender: string;
    reportEnclosed: boolean;
  };
};

const DRAFT_MARK_HTML = `<p class="draft-mark"><strong>${escapeHtml(DRAFT_WORDING_NOT_APPROVED)}.</strong> Waiting for Justin's approval.</p>`;
const DRAFT_MARK_TEXT = `${DRAFT_WORDING_NOT_APPROVED}. Waiting for Justin's approval.`;

function accidentDate(ctx: CorrespondenceContext, missing: string[]): string {
  return ctx.accidentAt ? formatUkDate(ctx.accidentAt) : claimValueOrGap("", "Accident date", missing);
}

function vehicle(ctx: CorrespondenceContext, missing: string[]): string {
  const makeModel = [ctx.make, ctx.model].filter((part) => !isBlankClaimValue(part)).join(" ").trim();
  const registration = isBlankClaimValue(ctx.registration) ? "" : ctx.registration.trim();
  if (!makeModel && !registration) return claimValueOrGap("", "Client vehicle make, model and registration", missing);
  if (!makeModel) missing.includes("Client vehicle make and model") || missing.push("Client vehicle make and model");
  return [makeModel, registration].filter(Boolean).join(" ");
}

function handler(ctx: CorrespondenceContext): string {
  return isBlankClaimValue(ctx.handlerName) ? CAS_COMPANY.name : ctx.handlerName.trim();
}

/** Turns the draft's lines into a letter: paragraphs in order, with the gaps marked. */
type Line = { html: string; text: string };
const p = (text: string, html?: string): Line => ({ text, html: `<p>${html ?? escapeHtml(text)}</p>` });
const gap = (value: string) => markGapHtml(value);

function finish(input: {
  key: ClientDraftKey;
  ctx: CorrespondenceContext;
  subject: string;
  lines: Line[];
  missing: string[];
  approved: boolean;
  addressee?: { name?: string; address?: string };
}): GeneratedLetter {
  const info = clientDraftInfo(input.key)!;
  const letterDate = formatUkDate(input.ctx.letterDate);
  const mark = input.approved ? [] : [{ html: DRAFT_MARK_HTML, text: DRAFT_MARK_TEXT }];
  const all = [...mark, ...input.lines];
  return {
    templateKey: input.key,
    title: info.title,
    subject: input.subject,
    html: wrapLetter(input.ctx, input.subject, all.map((line) => line.html).join("\n"), letterDate, input.addressee),
    text: [letterDate, input.subject, "", ...all.map((line) => line.text)].join("\n"),
    missing: input.missing,
    legalSignOffRequired: info.solicitor,
  };
}

function tickBox(label: string, html: string): Line {
  return { text: `[ ] ${label}`, html: `<p class="tick-line" data-required-tick><span class="tick-box">&#9744;</span> ${html}</p>` };
}

function signatureBlock(name: string): Line {
  return {
    text: `Signed: ______________ Name: ${name} Date: ________`,
    html: `<p class="signature-line">Signed: ______________ Name: ${gap(name)} Date: ________</p>`,
  };
}

/** Draft 1: Client instruction and authority (non-fault, split or disputed). */
export function draftClientAuthority(ctx: CorrespondenceContext, extras: ClientDraftExtras, approved: boolean): GeneratedLetter {
  const missing: string[] = [];
  const client = claimValueOrGap(ctx.clientName, "Client name", missing);
  const address = claimValueOrGap(extras.clientAddress, "Client address", missing);
  const car = vehicle(ctx, missing);
  const date = accidentDate(ctx, missing);
  const location = claimValueOrGap(ctx.accidentLocation, "Accident location", missing);
  const tpReg = claimValueOrGap(ctx.tpVehicleReg, "Third-party registration", missing);
  const subject = `Client Instruction and Authority — ${ctx.fileReference}`;
  const lines: Line[] = [
    p(
      `Client: ${client}, ${address}. Vehicle: ${car}. Accident: ${date} at ${location}, involving ${tpReg}.`,
      `Client: ${gap(client)}, ${gap(address)}. Vehicle: ${gap(car)}. Accident: ${gap(date)} at ${gap(location)}, involving ${gap(tpReg)}.`,
    ),
    p(`1. Instruction. I instruct Complete Accident Solutions Ltd ("CAS") to manage my claim arising from this accident. This may include recovery and storage of my vehicle, a replacement vehicle if I need one, an engineer's inspection, repairs, and pursuing my losses from the person responsible and their insurer.`, `1. <strong>Instruction.</strong> I instruct Complete Accident Solutions Ltd ("CAS") to manage my claim arising from this accident. This may include recovery and storage of my vehicle, a replacement vehicle if I need one, an engineer's inspection, repairs, and pursuing my losses from the person responsible and their insurer.`),
    p(`2. Authority. I authorise CAS to deal on my behalf with the third party's insurer and representatives, my own insurer, engineers, repairers and the police, and to request and receive information about the accident and my claim.`, `2. <strong>Authority.</strong> I authorise CAS to deal on my behalf with the third party's insurer and representatives, my own insurer, engineers, repairers and the police, and to request and receive information about the accident and my claim.`),
    p(`3. My information. The information I have given CAS is true to the best of my knowledge. I will tell CAS straight away if anything changes, or if any insurer, solicitor or claims company contacts me about this accident.`, `3. <strong>My information.</strong> The information I have given CAS is true to the best of my knowledge. I will tell CAS straight away if anything changes, or if any insurer, solicitor or claims company contacts me about this accident.`),
    p(`4. Help with the claim. I will provide my driving licence, insurance certificate, logbook (V5C) and any photographs or witness details I have. I will make my vehicle available for inspection, and give a signed statement if asked.`, `4. <strong>Help with the claim.</strong> I will provide my driving licence, insurance certificate, logbook (V5C) and any photographs or witness details I have. I will make my vehicle available for inspection, and give a signed statement if asked.`),
    p(`5. Charges. The charges for recovery, storage, hire and repairs are set out in the separate agreements I sign with CAS. This form does not change those agreements.`, `5. <strong>Charges.</strong> The charges for recovery, storage, hire and repairs are set out in the separate agreements I sign with CAS. This form does not change those agreements.`),
    p(`6. Payments. If an insurer pays me directly for a loss CAS has provided or paid for, I will tell CAS and pass that payment to CAS within [7] days.`, `6. <strong>Payments.</strong> If an insurer pays me directly for a loss CAS has provided or paid for, I will tell CAS and pass that payment to CAS within [7] days.`),
    p(`7. Offers. I will not accept an offer, or settle any part of this claim that covers services provided by CAS, without first telling CAS.`, `7. <strong>Offers.</strong> I will not accept an offer, or settle any part of this claim that covers services provided by CAS, without first telling CAS.`),
    p(`8. My own insurer. I authorise CAS to notify my own insurer of the accident. This is not a claim on my policy unless I ask for one.`, `8. <strong>My own insurer.</strong> I authorise CAS to notify my own insurer of the accident. This is not a claim on my policy unless I ask for one.`),
    p(`9. My information and privacy. I have been given CAS's privacy notice, which explains how CAS uses my personal information, including my driving licence check.`, `9. <strong>My information and privacy.</strong> I have been given CAS's privacy notice, which explains how CAS uses my personal information, including my driving licence check.`),
    tickBox(
      `10. Starting straight away. I ask CAS to start providing its services immediately, within the cancellation period. I have been given CAS's cancellation notice.`,
      `10. <strong>Starting straight away.</strong> I ask CAS to start providing its services immediately, within the cancellation period. I have been given CAS's cancellation notice.`,
    ),
    signatureBlock(client),
  ];
  return finish({ key: "draft_client_authority", ctx, subject, lines, missing, approved });
}

/** Draft 2: Client repair authority (fault claim). */
export function draftRepairAuthority(ctx: CorrespondenceContext, extras: ClientDraftExtras, approved: boolean): GeneratedLetter {
  const missing: string[] = [];
  const client = claimValueOrGap(ctx.clientName, "Client name", missing);
  const address = claimValueOrGap(extras.clientAddress, "Client address", missing);
  const car = vehicle(ctx, missing);
  const insurer = claimValueOrGap(ctx.ownInsurer, "Client's own insurer", missing);
  const policy = claimValueOrGap(ctx.ownPolicyRef, "Client's policy number", missing);
  const excess = extras.ownExcessPence != null ? formatGbp(extras.ownExcessPence).replace(/^£/, "") : claimValueOrGap("", "Policy excess", missing);
  const subject = `Repair Authority — ${ctx.fileReference}`;
  const lines: Line[] = [
    p(`Client: ${client}, ${address}. Vehicle: ${car}. My insurer: ${insurer}, policy ${policy}.`, `Client: ${gap(client)}, ${gap(address)}. Vehicle: ${gap(car)}. My insurer: ${gap(insurer)}, policy ${gap(policy)}.`),
    p(`1. Repairs. I ask Complete Accident Solutions Ltd ("CAS") to repair the accident damage to my vehicle, and to claim the cost from my insurer under my policy.`, `1. <strong>Repairs.</strong> I ask Complete Accident Solutions Ltd ("CAS") to repair the accident damage to my vehicle, and to claim the cost from my insurer under my policy.`),
    p(`2. My insurer. I authorise CAS to deal with my insurer, its engineers and its approved-repairer network about the repair, and to send them estimates, photographs and invoices.`, `2. <strong>My insurer.</strong> I authorise CAS to deal with my insurer, its engineers and its approved-repairer network about the repair, and to send them estimates, photographs and invoices.`),
    p(`3. Excess. I will pay my policy excess of £${excess} to CAS before my vehicle is released, unless my insurer tells CAS the excess is waived.`, `3. <strong>Excess.</strong> I will pay my policy excess of £${gap(excess)} to CAS before my vehicle is released, unless my insurer tells CAS the excess is waived.`),
    p(`4. Work not covered. If my insurer will not pay for part of the work (for example betterment, damage not caused by this accident, or extra work I ask for), CAS will tell me the cost in writing first. That work is only done if I agree to pay for it.`, `4. <strong>Work not covered.</strong> If my insurer will not pay for part of the work (for example betterment, damage not caused by this accident, or extra work I ask for), CAS will tell me the cost in writing first. That work is only done if I agree to pay for it.`),
    p(`5. If the repair does not go ahead. If my insurer declines the claim or decides my vehicle is a total loss, CAS will tell me. Recovery and storage charges are set out in the Storage & Recovery Agreement I sign.`, `5. <strong>If the repair does not go ahead.</strong> If my insurer declines the claim or decides my vehicle is a total loss, CAS will tell me. Recovery and storage charges are set out in the Storage &amp; Recovery Agreement I sign.`),
    p(`6. Courtesy car. Any courtesy car is provided under a separate Courtesy Car Agreement.`, `6. <strong>Courtesy car.</strong> Any courtesy car is provided under a separate Courtesy Car Agreement.`),
    p(`7. Collecting my vehicle. When the repair is finished, CAS will tell me and I will arrange to collect my vehicle within [Justin to set] days.`, `7. <strong>Collecting my vehicle.</strong> When the repair is finished, CAS will tell me and I will arrange to collect my vehicle within [Justin to set] days.`),
    p(`8. My information and privacy. I have been given CAS's privacy notice.`, `8. <strong>My information and privacy.</strong> I have been given CAS's privacy notice.`),
    tickBox(
      `9. Starting straight away. I ask CAS to start immediately, within the cancellation period. I have been given CAS's cancellation notice.`,
      `9. <strong>Starting straight away.</strong> I ask CAS to start immediately, within the cancellation period. I have been given CAS's cancellation notice.`,
    ),
    signatureBlock(client),
  ];
  return finish({ key: "draft_repair_authority", ctx, subject, lines, missing, approved });
}

function referenceLines(ours: string, entries: Array<{ label: string; value: string }>): Line[] {
  return [
    p(`Our Reference: ${ours}`, `Our Reference: <strong>${escapeHtml(ours)}</strong>`),
    ...entries.filter((entry) => !isBlankClaimValue(entry.value)).map((entry) => p(`${entry.label}: ${entry.value.trim()}`)),
  ];
}

function yoursFaithfully(ctx: CorrespondenceContext): Line[] {
  return [p("Yours faithfully,"), p(`${handler(ctx)}\n${CAS_COMPANY.name}`, `${escapeHtml(handler(ctx))}<br/>${escapeHtml(CAS_COMPANY.name)}`)];
}

/** Draft 3: Letter to the client's own insurer (fault claim). */
export function draftOwnInsurerNetwork(ctx: CorrespondenceContext, extras: ClientDraftExtras, approved: boolean): GeneratedLetter {
  const missing: string[] = [];
  const insurer = claimValueOrGap(ctx.ownInsurer, "Client's own insurer", missing);
  const policy = claimValueOrGap(ctx.ownPolicyRef, "Client's policy number", missing);
  const client = claimValueOrGap(ctx.clientName, "Client name", missing);
  const car = vehicle(ctx, missing);
  const date = accidentDate(ctx, missing);
  const location = claimValueOrGap(ctx.accidentLocation, "Accident location", missing);
  const where = claimValueOrGap(ctx.vehicleLocation, "Where the vehicle is now", missing);
  const subject = `Your Policyholder: ${client} — ${car} — Accident Date: ${date}`;
  const lines: Line[] = [
    ...referenceLines(ctx.fileReference, [
      // The insurer's own reference line is left out until it is held.
      { label: "Your Reference", value: extras.ownInsurerClaimRef },
    ]),
    p(`Policy Number: ${policy}`, `Policy Number: ${gap(policy)}`),
    p("Dear Sir / Madam,"),
    p(`Your Policyholder: ${client} — ${car} — Accident Date: ${date}`, `<strong>Your Policyholder: ${gap(client)} — ${gap(car)} — Accident Date: ${gap(date)}</strong>`),
    p(
      `We have been asked by your policyholder to carry out the repairs to the above vehicle following an accident on ${date} at ${location}.`,
      `We have been asked by your policyholder to carry out the repairs to the above vehicle following an accident on ${gap(date)} at ${gap(location)}.`,
    ),
    p("Please let us have by return:"),
    { text: "1. your claim reference; and\n2. your network (approved repairer) code, so that the repair can be networked to us.", html: "<ol><li>your claim reference; and</li><li>your network (approved repairer) code, so that the repair can be networked to us.</li></ol>" },
    extras.photosAttached
      ? p(`The vehicle is currently at ${where}. Photographs of the damage are attached and our estimate will follow.`, `The vehicle is currently at ${gap(where)}. Photographs of the damage are attached and our estimate will follow.`)
      : p(`The vehicle is currently at ${where}.`, `The vehicle is currently at ${gap(where)}.`),
    p(`Please quote our reference ${ctx.fileReference} on all correspondence.`),
    ...yoursFaithfully(ctx),
  ];
  return finish({ key: "draft_own_insurer_network", ctx, subject, lines, missing, approved, addressee: { name: insurer, address: ctx.ownInsurerAddress } });
}

/** Draft 4: Notification to the client's own insurer (non-fault, split or disputed). */
export function draftOwnInsurerNotice(ctx: CorrespondenceContext, _extras: ClientDraftExtras, approved: boolean): GeneratedLetter {
  const missing: string[] = [];
  const insurer = claimValueOrGap(ctx.ownInsurer, "Client's own insurer", missing);
  const policy = claimValueOrGap(ctx.ownPolicyRef, "Client's policy number", missing);
  const client = claimValueOrGap(ctx.clientName, "Client name", missing);
  const car = vehicle(ctx, missing);
  const date = accidentDate(ctx, missing);
  const location = claimValueOrGap(ctx.accidentLocation, "Accident location", missing);
  const tpReg = claimValueOrGap(ctx.tpVehicleReg, "Third-party registration", missing);
  const tpInsurer = claimValueOrGap(ctx.tpInsurer, "Third-party insurer", missing);
  const subject = `Your Policyholder: ${client} — ${car} — Accident Date: ${date}`;
  const lines: Line[] = [
    ...referenceLines(ctx.fileReference, []),
    p(`Policy Number: ${policy}`, `Policy Number: ${gap(policy)}`),
    p("Dear Sir / Madam,"),
    p(`Your Policyholder: ${client} — ${car} — Accident Date: ${date}`, `<strong>Your Policyholder: ${gap(client)} — ${gap(car)} — Accident Date: ${gap(date)}</strong>`),
    p(
      `We act on behalf of your policyholder in respect of an accident on ${date} at ${location} involving vehicle ${tpReg}, insured by ${tpInsurer}.`,
      `We act on behalf of your policyholder in respect of an accident on ${gap(date)} at ${gap(location)} involving vehicle ${gap(tpReg)}, insured by ${gap(tpInsurer)}.`,
    ),
    p("We write for notification purposes only. Our client is not making a claim under their policy, and we are pursuing their losses from the third party's insurer."),
    p("Please note our interest and quote our reference on any correspondence."),
    ...yoursFaithfully(ctx),
  ];
  return finish({ key: "draft_own_insurer_notice", ctx, subject, lines, missing, approved, addressee: { name: insurer, address: ctx.ownInsurerAddress } });
}

function splitShares(extras: ClientDraftExtras, missing: string[]): { theirs: string; ours: string } {
  if (extras.splitTpPercent == null) {
    const value = claimValueOrGap("", "Split shares (the third party's percentage)", missing);
    return { theirs: value, ours: value };
  }
  return { theirs: `${extras.splitTpPercent}%`, ours: `${100 - extras.splitTpPercent}%` };
}

/** Draft 5a: Split liability, letter to the third-party insurer. */
export function draftSplitTp(ctx: CorrespondenceContext, extras: ClientDraftExtras, approved: boolean): GeneratedLetter {
  const missing: string[] = [];
  const client = claimValueOrGap(ctx.clientName, "Client name", missing);
  const tpReg = claimValueOrGap(ctx.tpVehicleReg, "Third-party registration", missing);
  const date = accidentDate(ctx, missing);
  const tpRef = isBlankClaimValue(ctx.tpPolicyOrClaimRef) ? "" : ctx.tpPolicyOrClaimRef.trim();
  const shares = splitShares(extras, missing);
  const subject = `Our Client: ${client} — Your Insured: ${tpReg} — Accident Date: ${date}`;
  const lines: Line[] = [
    p("Dear Sir / Madam,"),
    p(subject, `<strong>Our Client: ${gap(client)} — Your Insured: ${gap(tpReg)} — Accident Date: ${gap(date)}</strong>`),
    tpRef
      ? p(`Your Reference: ${tpRef} — Our Reference: ${ctx.fileReference}`)
      : p(`Our Reference: ${ctx.fileReference}`),
    p(
      `We note your proposal that liability for this accident be shared ${shares.theirs} / ${shares.ours}. We are taking our client's instructions and will respond shortly. Nothing in this letter is an admission of liability.`,
      `We note your proposal that liability for this accident be shared ${gap(shares.theirs)} / ${gap(shares.ours)}. We are taking our client's instructions and will respond shortly. Nothing in this letter is an admission of liability.`,
    ),
    p("In the meantime, please confirm in writing the basis of your proposal and any evidence you rely on, including any statement from your insured, dash-cam footage or witness details."),
    p("Yours faithfully,"),
    p(`${handler(ctx)}, ${CAS_COMPANY.name}`),
  ];
  return finish({ key: "draft_split_tp", ctx, subject, lines, missing, approved, addressee: { name: ctx.tpInsurer, address: ctx.tpInsurerAddress } });
}

/** Draft 5b: Split liability, explanation to the client (letter or email). */
export function draftSplitClient(ctx: CorrespondenceContext, extras: ClientDraftExtras, approved: boolean): GeneratedLetter {
  const missing: string[] = [];
  const client = claimValueOrGap(ctx.clientName, "Client name", missing);
  const shares = splitShares(extras, missing);
  const subject = `Your claim — ${ctx.fileReference}`;
  const lines: Line[] = [
    p(`Dear ${client},`, `Dear ${gap(client)},`),
    p(
      `The other driver's insurer has suggested that liability for your accident should be shared, ${shares.theirs} / ${shares.ours}. We have not agreed to this.`,
      `The other driver's insurer has suggested that liability for your accident should be shared, ${gap(shares.theirs)} / ${gap(shares.ours)}. We have not agreed to this.`,
    ),
    p(
      `If a split is agreed, their insurer would pay only ${shares.theirs} of each part of your claim: repairs, recovery, storage and hire. The rest may be claimable from your own insurer if you have comprehensive cover, or may otherwise be your responsibility under the agreements you signed with us.`,
      `If a split is agreed, their insurer would pay only ${gap(shares.theirs)} of each part of your claim: repairs, recovery, storage and hire. The rest may be claimable from your own insurer if you have comprehensive cover, or may otherwise be your responsibility under the agreements you signed with us.`,
    ),
    p(`Before anything is agreed, we will call you to talk through your options, including whether your replacement vehicle should continue. Please call us on ${CAS_COMPANY.phone} if you have any questions.`),
    p(`Kind regards, ${handler(ctx)}`),
  ];
  return finish({ key: "draft_split_client", ctx, subject, lines, missing, approved, addressee: { name: ctx.clientName, address: extras.clientAddress } });
}

/** Draft 6: Liability disputed or not yet known, to the third-party insurer. */
export function draftLiabilityPosition(ctx: CorrespondenceContext, extras: ClientDraftExtras, approved: boolean): GeneratedLetter {
  const missing: string[] = [];
  const client = claimValueOrGap(ctx.clientName, "Client name", missing);
  const tpReg = claimValueOrGap(ctx.tpVehicleReg, "Third-party registration", missing);
  const date = accidentDate(ctx, missing);
  const time = ctx.accidentAt ? formatUkTime(ctx.accidentAt) : claimValueOrGap("", "Accident time", missing);
  const location = claimValueOrGap(ctx.accidentLocation, "Accident location", missing);
  // The handler types or checks the client's account. It is never written by the CRM.
  const account = claimValueOrGap(extras.accountLine, "Our client's account (typed or checked by the handler)", missing);
  const subject = `Our Client: ${client} — Your Insured's Vehicle: ${tpReg} — Accident Date: ${date}`;
  const mid =
    extras.mid && extras.mid.found && !isBlankClaimValue(extras.mid.policy)
      ? [p(`An MID search on ${formatUkDate(extras.mid.searchedOn)} showed the vehicle insured by you under policy ${extras.mid.policy.trim()}.`)]
      : [];
  const lines: Line[] = [
    ...referenceLines(ctx.fileReference, [
      { label: "Your Reference", value: ctx.tpPolicyOrClaimRef },
      { label: "Policy Number", value: ctx.tpPolicyNumber || "" },
    ]),
    p("Dear Sir / Madam,"),
    p(subject, `<strong>Our Client: ${gap(client)} — Your Insured's Vehicle: ${gap(tpReg)} — Accident Date: ${gap(date)}</strong>`),
    p(
      `We act on behalf of ${client} in respect of an accident on ${date} at ${time} at ${location}, involving your insured's vehicle ${tpReg}.`,
      `We act on behalf of ${gap(client)} in respect of an accident on ${gap(date)} at ${gap(time)} at ${gap(location)}, involving your insured's vehicle ${gap(tpReg)}.`,
    ),
    ...mid,
    p("Please confirm by return:"),
    {
      text: `1. that you are the insurer of vehicle ${tpReg} and that indemnity is in place;\n2. your claim reference; and\n3. your position on liability, with your insured's account of the accident.`,
      html: `<ol><li>that you are the insurer of vehicle ${gap(tpReg)} and that indemnity is in place;</li><li>your claim reference; and</li><li>your position on liability, with your insured's account of the accident.</li></ol>`,
    },
    p(`Our client's account is that ${account}. We reserve our client's position in full.`, `Our client's account is that ${gap(account)}. We reserve our client's position in full.`),
    ...yoursFaithfully(ctx),
  ];
  return finish({ key: "draft_liability_position", ctx, subject, lines, missing, approved, addressee: { name: ctx.tpInsurer, address: ctx.tpInsurerAddress } });
}

/**
 * The welcome for a fault claim: the supplied welcome with the third-party steps taken out (repairs and a courtesy car
 * only, no promise to recover losses from anyone else). New wording, so it waits for Justin's approval.
 */
export function draftFaultWelcome(ctx: CorrespondenceContext, _extras: ClientDraftExtras, approved: boolean): GeneratedLetter {
  const missing: string[] = [];
  const client = claimValueOrGap(ctx.clientName, "Client name", missing);
  const date = accidentDate(ctx, missing);
  const car = vehicle(ctx, missing);
  const insurer = claimValueOrGap(ctx.ownInsurer, "Client's own insurer", missing);
  const subject = `Your claim with ${CAS_COMPANY.name} — reference ${ctx.fileReference}`;
  const lines: Line[] = [
    p(`Dear ${client},`, `Dear ${gap(client)},`),
    p(
      `Thank you for instructing ${CAS_COMPANY.name} following your accident on ${date}. This email confirms we're now handling the repair of your vehicle, reference ${ctx.fileReference} — please use this reference in any contact with us.`,
      `Thank you for instructing ${escapeHtml(CAS_COMPANY.name)} following your accident on ${gap(date)}. This email confirms we're now handling the repair of your vehicle, reference <strong>${escapeHtml(ctx.fileReference)}</strong> — please use this reference in any contact with us.`,
    ),
    p("Here's what happens next:"),
    {
      text: `1. We contact your insurer, ${insurer}, about the repair of your vehicle, ${car}.\n2. We provide a courtesy car if one is arranged with you.\n3. Once your insurer approves the repair, we carry it out and return your vehicle to you.`,
      html: `<ol><li>We contact your insurer, ${gap(insurer)}, about the repair of your vehicle, ${gap(car)}.</li><li>We provide a courtesy car if one is arranged with you.</li><li>Once your insurer approves the repair, we carry it out and return your vehicle to you.</li></ol>`,
    },
    p("What we need from you:"),
    {
      text: "- Your insurance certificate and policy number\n- Your vehicle logbook (V5C) and driving licence\n- Any photos you have of the damage",
      html: "<ul><li>Your insurance certificate and policy number</li><li>Your vehicle logbook (V5C) and driving licence</li><li>Any photos you have of the damage</li></ul>",
    },
    p(`If you have any questions in the meantime, reply to this email or call us on ${CAS_COMPANY.phone}.`),
    p(`Kind regards,\n${handler(ctx)}\n${CAS_COMPANY.name}`, `Kind regards,<br/>${escapeHtml(handler(ctx))}<br/>${escapeHtml(CAS_COMPANY.name)}`),
  ];
  return finish({ key: "client_welcome_fault", ctx, subject, lines, missing, approved });
}

function pounds(pence: number | null | undefined, label: string, missing: string[]): string {
  if (pence == null) return claimValueOrGap("", label, missing);
  return formatGbp(pence).replace(/^£/, "");
}

/** Draft 8a: total loss, the valuation to the client with a reply form (signed on screen, by link or on paper). */
export function draftTotalLossClient(ctx: CorrespondenceContext, extras: ClientDraftExtras, approved: boolean): GeneratedLetter {
  const missing: string[] = [];
  const tl = extras.totalLoss;
  const client = claimValueOrGap(ctx.clientName, "Client name", missing);
  const car = vehicle(ctx, missing);
  const engineer = claimValueOrGap(tl?.engineerName, "Engineer's name", missing);
  const inspected = tl?.inspectionDate ? formatUkDate(tl.inspectionDate) : claimValueOrGap("", "Inspection date", missing);
  const pav = pounds(tl?.pavPence, "Pre-accident value", missing);
  const category = claimValueOrGap(tl?.salvageCategory, "Salvage category", missing);
  const salvage = pounds(tl?.salvagePence, "Salvage value", missing);
  const date = accidentDate(ctx, missing);
  const subject = `Your vehicle: ${car} — Our reference: ${ctx.fileReference}`;
  const lines: Line[] = [
    p(`Dear ${client},`, `Dear ${gap(client)},`),
    p(subject, `<strong>Your vehicle: ${gap(car)} — Our reference: ${escapeHtml(ctx.fileReference)}</strong>`),
    p(
      `Our independent engineer, ${engineer}, inspected your vehicle on ${inspected} and has assessed it as a total loss, which means it is uneconomical to repair.${tl?.reportEnclosed === false ? "" : " A copy of the report is enclosed."}`,
      `Our independent engineer, ${gap(engineer)}, inspected your vehicle on ${gap(inspected)} and has assessed it as a total loss, which means it is uneconomical to repair.${tl?.reportEnclosed === false ? "" : " A copy of the report is enclosed."}`,
    ),
    {
      text: `Pre-accident value: £${pav}\nSalvage category: ${category}\nSalvage value: £${salvage}`,
      html: `<table class="figures"><tr><td>Pre-accident value</td><td>£${gap(pav)}</td></tr><tr><td>Salvage category</td><td>${gap(category)}</td></tr><tr><td>Salvage value</td><td>£${gap(salvage)}</td></tr></table>`,
    },
    p("We will ask the other driver's insurer to pay the pre-accident value. Please tick one option below, sign and return it so we can do this."),
    tickBox("A. I accept the valuation. My vehicle can be released for salvage, and I will hand over the logbook (V5C) and keys.", "<strong>A.</strong> I accept the valuation. My vehicle can be released for salvage, and I will hand over the logbook (V5C) and keys."),
    tickBox(`B. I accept the valuation but want to keep my vehicle. I understand the salvage value of £${salvage} will be deducted.`, `<strong>B.</strong> I accept the valuation but want to keep my vehicle. I understand the salvage value of £${gap(salvage)} will be deducted.`),
    tickBox(`C. I do not accept the valuation because: ____________. (Adverts for similar vehicles for sale around ${date} help us challenge it.)`, `<strong>C.</strong> I do not accept the valuation because: ____________. (Adverts for similar vehicles for sale around ${gap(date)} help us challenge it.)`),
    p("Is there any finance outstanding on the vehicle? [ ] No [ ] Yes — lender: ________"),
    { text: "Signed: ______________ Date: ________", html: '<p class="signature-line">Signed: ______________ Date: ________</p>' },
    p("We will tell you separately when your replacement vehicle needs to be returned."),
    p(`Kind regards, ${handler(ctx)}`),
  ];
  return finish({ key: "draft_tl_client", ctx, subject, lines, missing, approved, addressee: { name: ctx.clientName, address: extras.clientAddress } });
}

/** Draft 8b: total loss, the covering letter to the third-party insurer. */
export function draftTotalLossInsurer(ctx: CorrespondenceContext, extras: ClientDraftExtras, approved: boolean): GeneratedLetter {
  const missing: string[] = [];
  const tl = extras.totalLoss;
  const client = claimValueOrGap(ctx.clientName, "Client name", missing);
  const tpReg = claimValueOrGap(ctx.tpVehicleReg, "Third-party registration", missing);
  const date = accidentDate(ctx, missing);
  const registration = claimValueOrGap(ctx.registration, "Client registration", missing);
  const pav = pounds(tl?.pavPence, "Pre-accident value", missing);
  const category = claimValueOrGap(tl?.salvageCategory, "Salvage category", missing);
  const salvage = pounds(tl?.salvagePence, "Salvage value", missing);
  const amount = pounds(tl?.amountRequestedPence, "Amount requested", missing);
  const tpRef = isBlankClaimValue(ctx.tpPolicyOrClaimRef) ? "" : ctx.tpPolicyOrClaimRef.trim();
  const choice = tl?.clientChoice || "";
  if (!choice) missing.push("The client's answer to the valuation (A or B)");
  const where = claimValueOrGap(tl?.vehicleLocation, "Where the vehicle is now", missing);
  const keeps = choice === "keep";
  const subject = `Our Client: ${client} — Your Insured's Vehicle: ${tpReg} — Accident Date: ${date}`;
  const lines: Line[] = [
    p("Dear Sir / Madam,"),
    p(subject, `<strong>Our Client: ${gap(client)} — Your Insured's Vehicle: ${gap(tpReg)} — Accident Date: ${gap(date)}</strong>`),
    tpRef ? p(`Your Reference: ${tpRef} — Our Reference: ${ctx.fileReference}`) : p(`Our Reference: ${ctx.fileReference}`),
    p(
      `Please find enclosed the engineer's report for our client's vehicle ${registration}, which has been assessed as a total loss: pre-accident value £${pav}, salvage category ${category}, salvage value £${salvage}.`,
      `Please find enclosed the engineer's report for our client's vehicle ${gap(registration)}, which has been assessed as a total loss: pre-accident value £${gap(pav)}, salvage category ${gap(category)}, salvage value £${gap(salvage)}.`,
    ),
    keeps
      ? p(`Our client accepts the valuation and our client will retain the vehicle. Please arrange payment of £${amount} by return.`, `Our client accepts the valuation and our client will retain the vehicle. Please arrange payment of £${gap(amount)} by return.`)
      : p(
          `Our client accepts the valuation and the vehicle is available for collection by your salvage agent from ${where}. Please arrange payment of £${amount} and collection of the salvage by return.`,
          `Our client accepts the valuation and the vehicle is available for collection by your salvage agent from ${gap(where)}. Please arrange payment of £${gap(amount)} and collection of the salvage by return.`,
        ),
    ...(tl?.financeLender ? [p(`There is outstanding finance with ${tl.financeLender}; please contact us before payment.`)] : []),
    p("Yours faithfully,"),
    p(`${handler(ctx)}, ${CAS_COMPANY.name}`),
  ];
  return finish({ key: "draft_tl_insurer", ctx, subject, lines, missing, approved, addressee: { name: ctx.tpInsurer, address: ctx.tpInsurerAddress } });
}

const GENERATORS: Partial<Record<ClientDraftKey, (ctx: CorrespondenceContext, extras: ClientDraftExtras, approved: boolean) => GeneratedLetter>> = {
  draft_client_authority: draftClientAuthority,
  draft_repair_authority: draftRepairAuthority,
  draft_own_insurer_network: draftOwnInsurerNetwork,
  draft_own_insurer_notice: draftOwnInsurerNotice,
  draft_split_tp: draftSplitTp,
  draft_split_client: draftSplitClient,
  draft_liability_position: draftLiabilityPosition,
  client_welcome_fault: draftFaultWelcome,
  draft_tl_client: draftTotalLossClient,
  draft_tl_insurer: draftTotalLossInsurer,
};

/** Draft 7 is an outline only. Nothing is generated until CAS's wording is in Settings. */
export const WAITING_FOR_CAS_WORDING = "Waiting for CAS's wording";

export function generateClientDraft(key: ClientDraftKey, ctx: CorrespondenceContext, extras: ClientDraftExtras, approved: boolean): GeneratedLetter {
  const generator = GENERATORS[key];
  if (!generator) throw new Error(`${clientDraftInfo(key)?.title || "This document"}: ${WAITING_FOR_CAS_WORDING}. Nothing is generated until it is in Settings.`);
  return generator(ctx, extras, approved);
}

/**
 * R63: the MID search added to the initial letter to the third-party insurer, as a short block, because the supplied
 * template has no place for it. New wording: it is added only once Justin has approved it in Settings.
 */
export const MID_BLOCK_KEY = "initial_letter_mid_block";

export function midBlockLines(mid: ClientDraftExtras["mid"]): { text: string; html: string } | null {
  if (!mid) return null;
  const searched = formatUkDate(mid.searchedOn);
  const registration = isBlankClaimValue(mid.registration) ? "" : mid.registration.trim();
  const result = mid.found
    ? `the vehicle was shown as insured${isBlankClaimValue(mid.insurer) ? "" : ` by ${mid.insurer.trim()}`}${isBlankClaimValue(mid.policy) ? "" : ` under policy ${mid.policy.trim()}`}`
    : "no insurance record was found";
  const text = `MID search: on ${searched} we searched the Motor Insurance Database${registration ? ` for registration ${registration}` : ""}; ${result}.`;
  return { text, html: `<p data-mid-block>${escapeHtml(text)}</p>` };
}
