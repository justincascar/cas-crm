import { CAS_CLAIMS_MAILBOX } from "../constants";
import { mailboxIsConnected, sendMailboxMessage } from "./microsoft-graph";

export type OutgoingMessage = {
  to: string;
  subject: string;
  body: string;
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

/** Used when Microsoft 365 credentials are not set. It records a simulated send and says so. */
export class SimulatedEmailGateway implements EmailGateway {
  name = "Simulated email (not connected)";
  simulated = true;

  async send(message: OutgoingMessage): Promise<SendResult> {
    if (!message.to.trim() || !message.subject.trim() || !message.body.trim()) {
      return { ok: false, status: "failed", error: "To, subject and body are required." };
    }
    return {
      ok: true,
      status: "simulated_sent",
      warning:
        "Not sent to a real mailbox. A clicked button is not proof of delivery. Connect CAS's email account before live sending.",
    };
  }
}

class RoutingEmailGateway implements EmailGateway {
  private readonly simulated = new SimulatedEmailGateway();

  get name() {
    return mailboxIsConnected() ? "Microsoft 365" : this.simulated.name;
  }

  get simulated() {
    return !mailboxIsConnected();
  }

  async send(message: OutgoingMessage): Promise<SendResult> {
    if (!mailboxIsConnected()) return this.simulated.send(message);
    try {
      await sendMailboxMessage(message);
      return { ok: true, status: "sent", warning: `Sent from ${CAS_CLAIMS_MAILBOX}.` };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Microsoft 365 did not send this email. Nothing was sent.";
      return { ok: false, status: "failed", error: messageText };
    }
  }
}

export const emailGateway: EmailGateway = new RoutingEmailGateway();
