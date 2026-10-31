import { formatUkDate, formatUkTime } from "../dates";
import { normalizeLiabilityStatus, type LiabilityStatus } from "../domain/claim-status";
import { CAS_COMPANY } from "./cas-hire-terms";
import {
  claimValueOrGap,
  escapeHtml,
  handlerInitials,
  isBlankClaimValue,
  joinEnglishList,
  markGapHtml,
  namesDiffer,
  wrapLetter,
  type CorrespondenceContext,
  type GeneratedLetter,
  type LetterContext,
} from "./correspondence";

export const FAULT_OWN_INSURER_KEY = "fault_own_insurer" as const;
export const NON_FAULT_TPI_KEY = "initial_tp_insurer" as const;

export function suggestedLetterTemplateKey(liabilityStatus: string | null | undefined): "fault_own_insurer" | "initial_tp_insurer" | null {
  const value = normalizeLiabilityStatus(liabilityStatus);
  if (value === "fault") return FAULT_OWN_INSURER_KEY;
  if (value === "non_fault") return NON_FAULT_TPI_KEY;
  return null;
}

export function letterSuggestionNote(liabilityStatus: string | null | undefined): string {
  const value = normalizeLiabilityStatus(liabilityStatus);
  if (value === "fault") {
    return "This file is Fault, so the letter to the client's own insurer is offered. The third-party insurer letter is not sent on a fault claim.";
  }
  if (value === "non_fault") {
    return "This file is Non-fault, so the initial letter to the third-party insurer is offered. You can still pick another document.";
  }
  if (value === "disputed") {
    return "Liability is Disputed, so neither letter is offered automatically. Pick the document once you know which insurer this is going to.";
  }
  return "Liability is not yet decided, so neither letter is offered automatically. Pick the document if you know which insurer this is going to.";
}

export function isSuggestedForLiability(templateKey: string, liabilityStatus: LiabilityStatus | string | null | undefined): boolean {
  return suggestedLetterTemplateKey(liabilityStatus) === templateKey;
}

function ourReference(ctx: LetterContext): string {
  const handler = isBlankClaimValue(ctx.handlerName) ? CAS_COMPANY.name : ctx.handlerName.trim();
  return `${ctx.fileReference}/${handlerInitials(handler)}/${handler}`;
}

function vehicleLine(
  make: string | undefined,
  model: string | undefined,
  registration: string | undefined,
  labels: { makeModel: string; registration: string },
  missing: string[],
): string {
  const makeModel = [make, model].filter((part) => !isBlankClaimValue(part)).join(" ").trim();
  // R39: the registration alone prints when the make is not known. The gap still shows on screen.
  if (!makeModel && !isBlankClaimValue(registration)) {
    missing.push(labels.makeModel);
    return String(registration).trim();
  }
  const makeModelText = makeModel || claimValueOrGap("", labels.makeModel, missing);
  const registrationText = claimValueOrGap(registration, labels.registration, missing);
  return `${makeModelText} ${registrationText}`.trim();
}

function letterClose(handlerName: string): { html: string; text: string } {
  const handler = isBlankClaimValue(handlerName) ? CAS_COMPANY.name : handlerName.trim();
  return {
    html: `<p>Yours faithfully,</p>
<p>${escapeHtml(handler)}<br/>${escapeHtml(CAS_COMPANY.name)}</p>`,
    // R42: the template note is shown on the screen above the sheet, never in the letter.
    text: ["Yours faithfully,", "", handler, CAS_COMPANY.name].join("\n"),
  };
}

/**
 * Every insurer letter carries the CAS reference and the insurer's reference. The insurer's claim reference and the
 * policy number are shown, whichever are held. A gap is shown only when neither is held.
 */
export function insurerReferenceLines(
  claimRef: string | null | undefined,
  policy: string | null | undefined,
  missing: string[],
): { lines: Array<{ label: string; value: string }>; haveClaimRef: boolean } {
  const lines: Array<{ label: string; value: string }> = [];
  const ref = isBlankClaimValue(claimRef) ? "" : String(claimRef).trim();
  const pol = isBlankClaimValue(policy) ? "" : String(policy).trim();
  if (ref) lines.push({ label: "Your Reference", value: ref });
  if (pol) lines.push({ label: "Policy Number", value: pol });
  if (!ref && !pol) lines.push({ label: "Your Reference", value: claimValueOrGap("", "Insurer's claim reference or policy number", missing) });
  return { lines, haveClaimRef: Boolean(ref) };
}

export function generateFaultOwnInsurerLetter(ctx: LetterContext | CorrespondenceContext): GeneratedLetter {
  const missing: string[] = [];
  const letterDate = formatUkDate(ctx.letterDate);
  const ourRef = ourReference(ctx);
  const insurer = claimValueOrGap(ctx.ownInsurer, "Client's own insurer", missing);
  const address = claimValueOrGap(ctx.ownInsurerAddress, "Client's own insurer address", missing);
  const refs = insurerReferenceLines(null, ctx.ownPolicyRef, missing);
  const client = claimValueOrGap(ctx.clientName, "Client name", missing);
  const vehicle = vehicleLine(ctx.make, ctx.model, ctx.registration, {
    makeModel: "Insured vehicle make and model",
    registration: "Insured vehicle registration",
  }, missing);
  const accidentDate = ctx.accidentAt ? formatUkDate(ctx.accidentAt) : claimValueOrGap("", "Accident date", missing);
  const accidentTime = ctx.accidentAt ? formatUkTime(ctx.accidentAt) : claimValueOrGap("", "Accident time", missing);
  const location = claimValueOrGap(ctx.accidentLocation, "Accident location", missing);
  const circumstances = claimValueOrGap(ctx.circumstances, "Accident circumstances", missing);
  const courtesy = Boolean(ctx.courtesyAllocated);
  const instructed = courtesy
    ? "We have been instructed to manage the repair of the insured vehicle on our client's behalf, and to arrange a courtesy vehicle while repairs are carried out."
    : "We have been instructed to manage the repair of the insured vehicle on our client's behalf.";
  const authorisation = courtesy
    ? "authorisation to arrange payment of repairs, and provision of a courtesy vehicle."
    : "authorisation to arrange payment of repairs.";
  const subject = `Fault claim — ${ctx.fileReference}`;
  const facts = [
    ...refs.lines.map((line) => `${line.label}: ${line.value}`),
    `Our Client: ${client}`,
    `Insured Vehicle: ${vehicle}`,
    `Accident Date: ${accidentDate}`,
    `Accident Time: ${accidentTime}`,
    `Accident Location: ${location}`,
  ];
  const text = [
    insurer,
    address,
    `Our Reference: ${ourRef}`,
    letterDate,
    "",
    "Dear Sir / Madam,",
    "",
    ...facts,
    "",
    `We act on behalf of your policyholder, ${client}, in connection with the above road traffic accident.`,
    "",
    `Circumstances: ${circumstances}`,
    "",
    instructed,
    "",
    "Please confirm by return:",
    ...(refs.haveClaimRef ? [] : ["- your claim reference;"]),
    "- that the policy is in place and covers this incident;",
    "- the policy excess payable, if any;",
    "- your Audatex network code and work provider code, so that our repair estimate can be networked to you directly; and",
    `- ${authorisation}`,
    "",
    "Please direct all future correspondence regarding the repair of this vehicle to ourselves.",
    "",
    "We look forward to hearing from you.",
    "",
    letterClose(ctx.handlerName).text,
  ].join("\n");
  const html = wrapLetter(
    ctx,
    subject,
    `<p>${markGapHtml(insurer)}</p>
<p>${markGapHtml(address)}</p>
<p>Our Reference: <strong>${escapeHtml(ourRef)}</strong></p>
<p>Dear Sir / Madam,</p>
${refs.lines.map((line) => `<p>${line.label}: ${markGapHtml(line.value)}</p>`).join("\n")}
<p>Our Client: ${markGapHtml(client)}</p>
<p>Insured Vehicle: ${markGapHtml(vehicle)}</p>
<p>Accident Date: ${markGapHtml(accidentDate)}</p>
<p>Accident Time: ${markGapHtml(accidentTime)}</p>
<p>Accident Location: ${markGapHtml(location)}</p>
<p>We act on behalf of your policyholder, ${markGapHtml(client)}, in connection with the above road traffic accident.</p>
<p>Circumstances: ${markGapHtml(circumstances)}</p>
<p>${escapeHtml(instructed)}</p>
<p>Please confirm by return:</p>
<ul>
${refs.haveClaimRef ? "" : "<li>your claim reference;</li>\n"}<li>that the policy is in place and covers this incident;</li>
<li>the policy excess payable, if any;</li>
<li>your Audatex network code and work provider code, so that our repair estimate can be networked to you directly; and</li>
<li>${escapeHtml(authorisation)}</li>
</ul>
<p>Please direct all future correspondence regarding the repair of this vehicle to ourselves.</p>
<p>We look forward to hearing from you.</p>
${letterClose(ctx.handlerName).html}`,
    letterDate,
  );
  return {
    templateKey: FAULT_OWN_INSURER_KEY,
    title: "Fault claim letter (client's own insurer)",
    subject,
    html,
    text,
    missing,
    legalSignOffRequired: false,
  };
}

export function generateNonFaultTpInsurerLetter(ctx: LetterContext | CorrespondenceContext): GeneratedLetter {
  const missing: string[] = [];
  const letterDate = formatUkDate(ctx.letterDate);
  const ourRef = ourReference(ctx);
  const insurer = claimValueOrGap(ctx.tpInsurer, "Third-party insurer", missing);
  const handler = isBlankClaimValue(ctx.tpHandlerName) ? "" : String(ctx.tpHandlerName).trim();
  const refs = insurerReferenceLines(ctx.tpPolicyOrClaimRef, ctx.tpPolicyNumber, missing);
  const client = claimValueOrGap(ctx.clientName, "Client name", missing);
  const showDriver = namesDiffer(ctx.clientDriverName || "", ctx.clientName);
  const driver = showDriver ? claimValueOrGap(ctx.clientDriverName, "Client's driver", missing) : "";
  const ownVehicle = vehicleLine(ctx.make, ctx.model, ctx.registration, {
    makeModel: "Client vehicle make and model",
    registration: "Client registration",
  }, missing);
  const theirVehicle = vehicleLine(ctx.tpVehicleMake, ctx.tpVehicleModel, ctx.tpVehicleReg, {
    makeModel: "Third-party vehicle make and model",
    registration: "Third-party registration",
  }, missing);
  const tpReg = claimValueOrGap(ctx.tpVehicleReg, "Third-party registration", missing);
  const accidentDate = ctx.accidentAt ? formatUkDate(ctx.accidentAt) : claimValueOrGap("", "Accident date", missing);
  const accidentTime = ctx.accidentAt ? formatUkTime(ctx.accidentAt) : claimValueOrGap("", "Accident time", missing);
  const location = claimValueOrGap(ctx.accidentLocation, "Accident location", missing);
  const subject = `Uninsured losses — ${ctx.fileReference}`;
  // The supplied notification template lists repairs, hire and related losses such as recovery and storage, so the
  // heads recorded on this file are listed.
  const losses = ctx.lossHeadsOnFile?.length ? joinEnglishList(ctx.lossHeadsOnFile) : "vehicle repair charges and credit hire charges";
  const facts = [
    ...refs.lines.map((line) => `${line.label}: ${line.value}`),
    `Our Client: ${client}`,
    ...(showDriver ? [`Our Client's Driver: ${driver}`] : []),
    `Our Insured's Vehicle: ${ownVehicle}`,
    `Your Insured's Vehicle: ${theirVehicle}`,
    `Accident Date: ${accidentDate}`,
    `Accident Time: ${accidentTime}`,
    `Accident Location: ${location}`,
    ...(ctx.midBlock ? [ctx.midBlock.text] : []),
  ];
  const text = [
    insurer,
    ...(handler ? [`c/o ${handler}`] : []),
    `Our Reference: ${ourRef}`,
    letterDate,
    "",
    "Dear Sir / Madam,",
    "",
    ...facts,
    "",
    `We act on behalf of ${client} in respect of uninsured losses arising from the above road traffic accident.`,
    "",
    "Accordingly, we place you on notice of our client's claim.",
    "",
    `Our client's losses include ${losses}. Full supporting documentation is being provided with our covering email.`,
    "",
    "Please confirm by return:",
    ...(refs.haveClaimRef ? [] : ["- your claim reference;"]),
    `- that you are the relevant insurer/claims handler for vehicle ${tpReg};`,
    "- that indemnity is in place; and",
    "- your position on liability.",
    "",
    "All future correspondence regarding this matter should be directed to ourselves.",
    "",
    "We look forward to hearing from you.",
    "",
    letterClose(ctx.handlerName).text,
  ].join("\n");
  const handlerRow = handler ? `<p>c/o ${escapeHtml(handler)}</p>\n` : "";
  const driverRow = showDriver ? `<p>Our Client's Driver: ${markGapHtml(driver)}</p>\n` : "";
  const html = wrapLetter(
    ctx,
    subject,
    `<p>${markGapHtml(insurer)}</p>
${handlerRow}<p>Our Reference: <strong>${escapeHtml(ourRef)}</strong></p>
<p>Dear Sir / Madam,</p>
${refs.lines.map((line) => `<p>${line.label}: ${markGapHtml(line.value)}</p>`).join("\n")}
<p>Our Client: ${markGapHtml(client)}</p>
${driverRow}<p>Our Insured's Vehicle: ${markGapHtml(ownVehicle)}</p>
<p>Your Insured's Vehicle: ${markGapHtml(theirVehicle)}</p>
<p>Accident Date: ${markGapHtml(accidentDate)}</p>
<p>Accident Time: ${markGapHtml(accidentTime)}</p>
<p>Accident Location: ${markGapHtml(location)}</p>
${ctx.midBlock ? `${ctx.midBlock.html}\n` : ""}<p>We act on behalf of ${markGapHtml(client)} in respect of uninsured losses arising from the above road traffic accident.</p>
<p>Accordingly, we place you on notice of our client's claim.</p>
<p>Our client's losses include ${escapeHtml(losses)}. Full supporting documentation is being provided with our covering email.</p>
<p>Please confirm by return:</p>
<ul>
${refs.haveClaimRef ? "" : "<li>your claim reference;</li>\n"}<li>that you are the relevant insurer/claims handler for vehicle ${markGapHtml(tpReg)};</li>
<li>that indemnity is in place; and</li>
<li>your position on liability.</li>
</ul>
<p>All future correspondence regarding this matter should be directed to ourselves.</p>
<p>We look forward to hearing from you.</p>
${letterClose(ctx.handlerName).html}`,
    letterDate,
  );
  return {
    templateKey: NON_FAULT_TPI_KEY,
    title: "Non-fault initial letter (third-party insurer)",
    subject,
    html,
    text,
    missing,
    legalSignOffRequired: false,
  };
}
