import type { OutgoingMessage } from "../email/gateway";
import { CAS_EMAIL_SPECS } from "./cas-wording";
import {
  emptyCorrespondenceFields,
  generateFromSpec,
  recipientFor,
  type CorrespondenceContext,
  type GeneratedLetter,
  type LetterContext,
} from "./correspondence";

export const EMAIL_TEMPLATES = [
  {
    key: "client_welcome",
    title: "Client welcome (intake)",
    eventType: "client_welcome_sent" as const,
    channel: "email" as const,
  },
  {
    key: "payment_chase_1",
    title: "Payment chase 1 — first reminder",
    eventType: "payment_chase_1_sent" as const,
    channel: "email" as const,
  },
  {
    key: "payment_chase_2",
    title: "Payment chase 2 — final warning",
    eventType: "payment_chase_2_sent" as const,
    channel: "email" as const,
  },
  {
    key: "client_total_loss_update",
    title: "Client total-loss update",
    eventType: "client_total_loss_update_sent" as const,
    channel: "email" as const,
  },
  {
    key: "client_status_update",
    title: "Client status update",
    eventType: "client_status_update_sent" as const,
    channel: "email" as const,
  },
  {
    key: "vehicle_ready",
    title: "Vehicle ready for collection",
    eventType: "vehicle_ready_notice_sent" as const,
    channel: "email" as const,
  },
  {
    key: "case_closed",
    title: "Case closed — payment received",
    eventType: "case_closed" as const,
    channel: "email" as const,
  },
] as const;

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
  const generated = generateFromSpec(spec, full);
  const to = recipientFor(spec.audience, full);
  return {
    ...generated,
    to,
    message: { to, subject: generated.subject, body: generated.text },
  };
}
