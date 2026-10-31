import type { OutgoingMessage } from "../email/gateway";
import { CAS_EMAIL_SPECS } from "./cas-wording";
import { insurerReferenceLines } from "./notification-letters";
import {
  emptyCorrespondenceFields,
  generateFromSpec,
  recipientFor,
  type CorrespondenceContext,
  type GeneratedLetter,
  type LetterContext,
} from "./correspondence";

/** Who the general composer may offer this template to. "Other" is not listed: that choice shows every template. */
export const EMAIL_TEMPLATES = [
  {
    key: "initial_tp_insurer_email",
    title: "Initial email to the third-party insurer",
    eventType: "initial_letter_tp_insurer" as const,
    channel: "email" as const,
    forRoles: ["third_party"] as const,
  },
  {
    key: "client_welcome",
    title: "Client welcome (intake)",
    eventType: "client_welcome_sent" as const,
    channel: "email" as const,
    forRoles: ["client"] as const,
  },
  {
    key: "client_total_loss_update",
    title: "Client total-loss update",
    eventType: "client_total_loss_update_sent" as const,
    channel: "email" as const,
    forRoles: ["client"] as const,
  },
  {
    key: "client_status_update",
    title: "Client status update",
    eventType: "client_status_update_sent" as const,
    channel: "email" as const,
    forRoles: ["client"] as const,
  },
  {
    key: "vehicle_ready",
    title: "Vehicle ready for collection",
    eventType: "vehicle_ready_notice_sent" as const,
    channel: "email" as const,
    forRoles: ["client"] as const,
  },
  {
    key: "case_closed",
    title: "Case closed — payment received",
    eventType: "case_closed" as const,
    channel: "email" as const,
    forRoles: ["client"] as const,
  },
] as const;

/**
 * Letters and emails to the third-party insurer about a non-fault claim. They are never offered or produced on a
 * fault file. The impecuniosity response is left out: it has its own approval.
 */
export const THIRD_PARTY_ONLY_TEMPLATES: readonly string[] = [
  "initial_tp_insurer",
  "initial_tp_insurer_email",
  "liability_chaser",
  "hire_pack_cover",
  "rebuttal_rate",
  "rebuttal_need",
  "rebuttal_duration",
  "total_loss_cessation",
  // R64: the drafts addressed to the third-party insurer, and the non-fault own-insurer notification and authority.
  "draft_split_tp",
  "draft_split_client",
  "draft_liability_position",
  "draft_own_insurer_notice",
  "draft_client_authority",
  "draft_tl_insurer",
];

export function emailTemplatesForRole(role: string, fault = false) {
  const fits = fault ? EMAIL_TEMPLATES.filter((template) => !THIRD_PARTY_ONLY_TEMPLATES.includes(template.key)) : [...EMAIL_TEMPLATES];
  if (role === "other") return fits;
  return fits.filter((template) => (template.forRoles as readonly string[]).includes(role));
}

/** Keep the current template when it still fits the role. Otherwise take the first that does. */
export function templateKeyForRole(role: string, currentKey: string, fault = false): string {
  const allowed = emailTemplatesForRole(role, fault);
  if (allowed.some((template) => template.key === currentKey)) return currentKey;
  return allowed[0]?.key ?? "";
}

export type EmailTemplateKey = (typeof EMAIL_TEMPLATES)[number]["key"];

export type GeneratedEmail = GeneratedLetter & {
  to: string;
  message: OutgoingMessage;
};

export function isEmailTemplateKey(key: string): key is EmailTemplateKey {
  return EMAIL_TEMPLATES.some((t) => t.key === key);
}

function asCorrespondence(ctx: LetterContext | CorrespondenceContext): CorrespondenceContext {
  return { ...emptyCorrespondenceFields(), ...ctx };
}

export function generateEmail(templateKey: EmailTemplateKey, ctx: LetterContext | CorrespondenceContext): GeneratedEmail {
  const spec = CAS_EMAIL_SPECS.find((item) => item.key === templateKey);
  if (!spec) throw new Error(`Unknown email template: ${templateKey}`);
  const full = asCorrespondence(ctx);
  const raw = generateFromSpec(spec, full);
  const generated = templateKey === "initial_tp_insurer_email" ? withInsurerReferences(raw, full) : raw;
  const to = recipientFor(spec.audience, full);
  return {
    ...generated,
    to,
    message: { to, subject: generated.subject, body: generated.text },
  };
}

/**
 * The insurer's claim reference and policy number, whichever are held, in place of the policy line. The request for
 * a claim reference is left out when we already hold it, and the remaining requests are renumbered.
 */
function withInsurerReferences(generated: GeneratedLetter, ctx: CorrespondenceContext): GeneratedLetter {
  const refs = insurerReferenceLines(ctx.tpPolicyOrClaimRef, ctx.tpPolicyNumber, []);
  const refText = refs.lines.map((line) => `${line.label}: ${line.value}`).join("\n");
  let text = generated.text.replace(/^Policy Number: .*$/m, refText);
  if (refs.haveClaimRef) {
    let n = 0;
    text = text
      .split("\n")
      .filter((line) => !/^1\. Provide your claim reference$/.test(line.trim()))
      .map((line) => (/^\d+\. /.test(line) ? line.replace(/^\d+/, String(++n)) : line))
      .join("\n");
  }
  return { ...generated, text };
}
