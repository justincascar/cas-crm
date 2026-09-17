import { formatUkDate } from "../dates";
import { eventLabel, type ChronologyDateMap } from "../domain/events";

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
};

export type GeneratedLetter = {
  templateKey: string;
  title: string;
  subject: string;
  html: string;
  text: string;
  missing: string[];
};

export const LETTER_TEMPLATES = [
  {
    key: "initial_tp_insurer",
    title: "Initial letter to third-party insurer",
    eventType: "initial_letter_tp_insurer" as const,
  },
  {
    key: "engineer_instruction",
    title: "Engineer instruction",
    eventType: "engineer_instructed" as const,
  },
  {
    key: "repair_commencement",
    title: "Repair commencement letter",
    eventType: "repairs_started" as const,
  },
  {
    key: "liability_chaser",
    title: "Liability chaser",
    eventType: "liability_chase_sent" as const,
  },
] as const;

export type LetterTemplateKey = (typeof LETTER_TEMPLATES)[number]["key"];

function missingFields(ctx: LetterContext): string[] {
  const missing: string[] = [];
  if (!ctx.clientName || ctx.clientName === "Unknown") missing.push("Client name");
  if (!ctx.accidentAt) missing.push("Accident date");
  if (!ctx.tpInsurer || ctx.tpInsurer === "Unknown") missing.push("Third-party insurer");
  if (!ctx.tpPolicyOrClaimRef || ctx.tpPolicyOrClaimRef === "Unknown") missing.push("Third-party insurer reference");
  if (!ctx.registration || ctx.registration === "Unknown") missing.push("Client registration");
  return missing;
}

function heading(ctx: LetterContext, extraRef?: string) {
  const policy = extraRef || ctx.tpPolicyOrClaimRef || ctx.ownPolicyRef || "Unknown";
  return `Our ref: ${ctx.fileReference}  Your policy: ${policy}`;
}

function dateLine(iso: string | null | undefined, fallback = "not yet recorded on the file"): string {
  return iso ? formatUkDate(iso) : fallback;
}

export function generateLetter(templateKey: LetterTemplateKey, ctx: LetterContext): GeneratedLetter {
  const missing = missingFields(ctx);
  const letterDate = formatUkDate(ctx.letterDate);
  const accident = dateLine(ctx.accidentAt);
  const vehicle = `${ctx.make} ${ctx.model}`.trim() || "Unknown vehicle";
  const commonClose = `<p>Yours faithfully</p><p>${escapeHtml(ctx.handlerName)}<br/>Complete Accident Solutions Ltd</p>
<p class="text-xs">Placeholder wording pending CAS letter templates. No legal threat is included. This is not a letter before action.</p>`;

  if (templateKey === "initial_tp_insurer") {
    const subject = heading(ctx);
    const text = [
      "Dear Sir / Madam",
      "",
      subject,
      "",
      `We write regarding our client ${ctx.clientName} and the accident on ${accident} at ${ctx.accidentLocation}.`,
      `Our client's vehicle is ${vehicle}, registration ${ctx.registration}.`,
      ctx.circumstances,
      "Please confirm your interest and your position on liability.",
      "We look forward to hearing from you.",
    ].join("\n");
    const html = wrapLetter(
      ctx,
      subject,
      `<p>Dear Sir / Madam</p>
<p>We write regarding our client <strong>${escapeHtml(ctx.clientName)}</strong> and the accident on <strong>${accident}</strong> at ${escapeHtml(ctx.accidentLocation)}.</p>
<p>Our client's vehicle is ${escapeHtml(vehicle)}, registration <strong>${escapeHtml(ctx.registration)}</strong>.</p>
<p>${escapeHtml(ctx.circumstances)}</p>
<p>Please confirm your interest and your position on liability.</p>
<p>We look forward to hearing from you.</p>
${commonClose}`,
      letterDate,
    );
    return { templateKey, title: "Initial letter to third-party insurer", subject, html, text, missing };
  }

  if (templateKey === "engineer_instruction") {
    const subject = `Our ref: ${ctx.fileReference} — engineer instruction`;
    const notified = dateLine(ctx.dates.initial_letter_tp_insurer);
    const text = [
      "Dear Sir / Madam",
      "",
      subject,
      "",
      `Please inspect ${vehicle}, registration ${ctx.registration}, for ${ctx.clientName}.`,
      `Accident date: ${accident}. Third-party insurer first notified: ${notified}.`,
      "The engineer supplies the report. Staff must verify any extracted figures before they drive payments or documents.",
    ].join("\n");
    const html = wrapLetter(
      ctx,
      subject,
      `<p>Dear Sir / Madam</p>
<p>Please inspect ${escapeHtml(vehicle)}, registration <strong>${escapeHtml(ctx.registration)}</strong>, for our client ${escapeHtml(ctx.clientName)}.</p>
<p>Accident date: <strong>${accident}</strong>. Third-party insurer first notified: <strong>${notified}</strong>.</p>
<p>The engineer supplies the report. Staff must verify any extracted figures before they drive payments or documents.</p>
${commonClose}`,
      letterDate,
    );
    return { templateKey, title: "Engineer instruction", subject, html, text, missing };
  }

  if (templateKey === "repair_commencement") {
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
${commonClose}`,
      letterDate,
    );
    return { templateKey, title: "Repair commencement letter", subject, html, text, missing };
  }

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
${commonClose}`,
    letterDate,
  );
  return { templateKey, title: "Liability chaser", subject, html, text, missing };
}

function wrapLetter(ctx: LetterContext, subject: string, body: string, letterDate: string) {
  return `<article class="letter">
<header>
<p><strong>Complete Accident Solutions Ltd</strong></p>
<p>${letterDate}</p>
<p>${escapeHtml(subject)}</p>
</header>
${body}
</article>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export { eventLabel };
