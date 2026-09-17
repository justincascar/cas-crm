export type OutgoingMessage = {
  to: string;
  subject: string;
  body: string;
};

export type SendResult =
  | { ok: true; status: "simulated_sent"; warning: string }
  | { ok: false; status: "failed"; error: string };

export interface EmailGateway {
  name: string;
  simulated: boolean;
  send(message: OutgoingMessage): Promise<SendResult>;
}

/** Live Microsoft 365 / IMAP will replace this once CAS confirms the mailbox. */
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

export const emailGateway: EmailGateway = new SimulatedEmailGateway();
