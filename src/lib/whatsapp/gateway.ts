export type WhatsAppMessage = {
  to: string;
  body: string;
};

export type WhatsAppSendResult =
  | { ok: true; status: "simulated_sent"; warning: string }
  | { ok: false; status: "failed"; error: string };

export interface WhatsAppGateway {
  name: string;
  simulated: boolean;
  send(message: WhatsAppMessage): Promise<WhatsAppSendResult>;
}

/** Live WhatsApp Business Platform will replace this once CAS confirms the account. */
export class SimulatedWhatsAppGateway implements WhatsAppGateway {
  name = "Simulated WhatsApp (not connected)";
  simulated = true;

  async send(message: WhatsAppMessage): Promise<WhatsAppSendResult> {
    if (!message.to.trim() || !message.body.trim()) {
      return { ok: false, status: "failed", error: "A number and a message are required." };
    }
    return {
      ok: true,
      status: "simulated_sent",
      warning:
        "Not sent on WhatsApp. A clicked button is not proof of delivery. Connect CAS's WhatsApp Business account before live sending.",
    };
  }
}

export const whatsappGateway: WhatsAppGateway = new SimulatedWhatsAppGateway();
