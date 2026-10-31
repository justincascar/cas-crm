import { CAS_CLAIMS_MAILBOX } from "../constants";
import { emailSendMode } from "./send-mode";
import { mailboxIsConnected, sendMailboxMessage } from "./microsoft-graph";

export type OutgoingAttachment = {
  name: string;
  contentType: string;
  content: Buffer;
};

export type OutgoingMessage = {
  to: string;
  /** R65: copied in (for example the file's handler on an engineer instruction). */
  cc?: string[];
  subject: string;
  body: string;
  attachments?: OutgoingAttachment[];
};

export type SendResult =
  | { ok: true; status: "simulated_sent"; warning: string }
  | { ok: true; status: "sent"; warning: string }
  | { ok: false; status: "failed"; error: string };

export interface EmailGateway {
  name: string;
  simulated: boolean;
  send(message: OutgoingMessage): Promise<SendResult>;
}

const SIMULATED_WARNING =
  "Not sent to a real mailbox. A clicked button is not proof of delivery. Connect CAS's email account before live sending.";

const LIVE_CREDENTIALS_MISSING =
  "Live sending is switched on, but Microsoft 365 credentials are missing. Nothing was sent.";

/**
 * The only outbound email function. Every send path must call this.
 * Graph is contacted only when EMAIL_SEND_MODE is exactly live and credentials exist.
 */
export async function sendOutboundEmail(message: OutgoingMessage): Promise<SendResult> {
  if (!message.to.trim() || !message.subject.trim() || !message.body.trim()) {
    return { ok: false, status: "failed", error: "To, subject and body are required." };
  }
  if (emailSendMode() !== "live") {
    return { ok: true, status: "simulated_sent", warning: SIMULATED_WARNING };
  }
  if (!mailboxIsConnected()) {
    return { ok: false, status: "failed", error: LIVE_CREDENTIALS_MISSING };
  }
  try {
    await sendMailboxMessage({
      to: message.to,
      cc: message.cc,
      subject: message.subject,
      body: message.body,
      attachments: message.attachments,
    });
    return { ok: true, status: "sent", warning: `Sent from ${CAS_CLAIMS_MAILBOX}.` };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Microsoft 365 did not send this email. Nothing was sent.";
    return { ok: false, status: "failed", error: messageText };
  }
}

/** Kept for callers that already hold a gateway. It uses the shared send function. */
export class SimulatedEmailGateway implements EmailGateway {
  get name() {
    return emailSendMode() === "live" ? "Microsoft 365" : "Simulated email (not connected)";
  }

  get simulated() {
    return emailSendMode() !== "live";
  }

  send(message: OutgoingMessage): Promise<SendResult> {
    return sendOutboundEmail(message);
  }
}

class RoutingEmailGateway implements EmailGateway {
  private readonly fallback = new SimulatedEmailGateway();

  get name() {
    return this.fallback.name;
  }

  get simulated() {
    return this.fallback.simulated;
  }

  send(message: OutgoingMessage): Promise<SendResult> {
    return sendOutboundEmail(message);
  }
}

export const emailGateway: EmailGateway = new RoutingEmailGateway();
