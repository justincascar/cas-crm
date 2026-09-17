export type PlaceCallInput = {
  to: string;
  direction: "outgoing" | "incoming";
};

export type CallResult =
  | { ok: true; status: "simulated_logged"; warning: string }
  | { ok: false; status: "failed"; error: string };

export interface PhoneGateway {
  name: string;
  simulated: boolean;
  place(input: PlaceCallInput): Promise<CallResult>;
}

/** Live telephony will replace this once CAS confirms the office phone system. */
export class SimulatedPhoneGateway implements PhoneGateway {
  name = "Simulated telephone (not connected)";
  simulated = true;

  async place(input: PlaceCallInput): Promise<CallResult> {
    if (!input.to.trim()) {
      return { ok: false, status: "failed", error: "A telephone number is required." };
    }
    return {
      ok: true,
      status: "simulated_logged",
      warning:
        input.direction === "outgoing"
          ? "The call was not placed on a live telephone line. Record the outcome here. Connect CAS's phone system before live dialling."
          : "Incoming calls are logged by staff until a live telephone system is connected. This is not a recording of a real call.",
    };
  }
}

export const phoneGateway: PhoneGateway = new SimulatedPhoneGateway();
