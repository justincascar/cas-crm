export type SendToRole = "client" | "own_insurer" | "third_party" | "representative" | "engineer" | "other";

export type SendToOption = {
  role: SendToRole;
  label: string;
  email: string;
  missingMessage: string | null;
};

export type ComposerContacts = {
  clientEmail?: string | null;
  ownInsurerEmail?: string | null;
  thirdPartyEmail?: string | null;
  representativeRecorded?: boolean;
  representativeEmail?: string | null;
  engineerInstructed?: boolean;
  engineerEmail?: string | null;
};

const MISSING = {
  client: "No email on file for the client — enter one manually, or add it on the client record.",
  own_insurer: "No email on file for the client's own insurer — enter one manually, or add it on Client insurer.",
  third_party: "No email on file for the third party insurer — enter one manually, or add it on Third party 1.",
  representative: "No email on file for the third party representative — enter one manually, or add it on Third party 1.",
  engineer: "No email on file for the engineer — enter one manually, or add it under Settings → Engineers.",
} as const;

/** A saved blank or the placeholder "Unknown" is not an address. */
export function savedText(value: string | number | null | undefined): string {
  const text = String(value ?? "").trim();
  if (!text || /^unknown$/i.test(text)) return "";
  return text;
}

export function representativeIsRecorded(row: {
  representative?: string | number | null;
  agent_name?: string | number | null;
  agent_email?: string | number | null;
  agent_handler_name?: string | number | null;
  agent_handler_email?: string | number | null;
} | null | undefined): boolean {
  if (!row) return false;
  return [row.representative, row.agent_name, row.agent_email, row.agent_handler_name, row.agent_handler_email].some(
    (value) => savedText(value) !== "",
  );
}

export function buildSendToOptions(input: ComposerContacts): SendToOption[] {
  const clientEmail = savedText(input.clientEmail);
  const ownInsurerEmail = savedText(input.ownInsurerEmail);
  const thirdPartyEmail = savedText(input.thirdPartyEmail);
  const representativeEmail = savedText(input.representativeEmail);
  const engineerEmail = savedText(input.engineerEmail);
  const options: SendToOption[] = [
    option("client", "Client", clientEmail, MISSING.client),
    option("own_insurer", "Client's own insurer", ownInsurerEmail, MISSING.own_insurer),
    option("third_party", "Third party (insurer)", thirdPartyEmail, MISSING.third_party),
    option("representative", "Third party representative", representativeEmail, MISSING.representative),
  ];
  if (input.engineerInstructed) {
    options.push(option("engineer", "Engineer", engineerEmail, MISSING.engineer));
  }
  options.push({ role: "other", label: "Other / type manually", email: "", missingMessage: null });
  return options;
}

function option(role: SendToRole, label: string, email: string, missing: string): SendToOption {
  return { role, label, email, missingMessage: email ? null : missing };
}

export function applySendToChoice(input: {
  role: SendToRole;
  options: SendToOption[];
  currentAddress: string;
  filledAddress: string;
  confirmed: boolean;
}):
  | { needsConfirm: true }
  | { needsConfirm: false; address: string; filledAddress: string; missingMessage: string | null } {
  const choice = input.options.find((item) => item.role === input.role);
  if (!choice) {
    return {
      needsConfirm: false,
      address: input.currentAddress,
      filledAddress: input.filledAddress,
      missingMessage: null,
    };
  }
  const current = input.currentAddress.trim();
  const filled = input.filledAddress.trim();
  const typedManually = current !== "" && current !== filled;
  if (choice.role === "other") {
    if (typedManually) {
      return { needsConfirm: false, address: input.currentAddress, filledAddress: "", missingMessage: null };
    }
    return { needsConfirm: false, address: "", filledAddress: "", missingMessage: null };
  }
  if (typedManually && !input.confirmed) return { needsConfirm: true };
  return {
    needsConfirm: false,
    address: choice.email,
    filledAddress: choice.email,
    missingMessage: choice.missingMessage,
  };
}
