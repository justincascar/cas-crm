export const SIGNATORY_RELATIONSHIPS = [
  { value: "client", label: "Client" },
  { value: "owner", label: "Owner" },
  { value: "hirer", label: "Hirer" },
  { value: "driver", label: "Driver" },
  { value: "other", label: "Other authorised person" },
] as const;

export type SignatoryRelationship = (typeof SIGNATORY_RELATIONSHIPS)[number]["value"];

export const SIGNATURE_HONESTY =
  "Signed on CAS device, not an independently verified electronic signature.";

export function signatoryRelationshipLabel(value: string | null | undefined): string {
  return SIGNATORY_RELATIONSHIPS.find((item) => item.value === value)?.label || "";
}

export type HandoverSignatureInput = {
  name?: string;
  relationship?: string;
  png?: string;
  skipReason?: string;
  /** The handover form ticked “no signature”. A reason is then required, and any drawing is ignored. */
  skipped?: boolean;
};

const MAX_SIGNATURE_CHARS = 400_000;

export function storedSignature(input: HandoverSignatureInput | undefined): {
  name: string | null;
  relationship: string | null;
  png: string | null;
  skipReason: string | null;
} {
  if (!input) return { name: null, relationship: null, png: null, skipReason: null };
  const name = (input.name || "").trim().slice(0, 120);
  const relationship = (input.relationship || "").trim();
  const png = (input.png || "").trim();
  const skipReason = (input.skipReason || "").trim().slice(0, 500);
  if (input.skipped) {
    if (!skipReason) throw new Error("Say why there is no signature.");
    return { name: null, relationship: null, png: null, skipReason };
  }
  if (png && skipReason) throw new Error("Either capture a signature or say why it was not signed.");
  if (skipReason) return { name: null, relationship: null, png: null, skipReason };
  if (!png && !name && !relationship) throw new Error("Capture a signature, or say why there is no signature.");
  if (!png.startsWith("data:image/png;base64,")) throw new Error("The signature could not be read. Draw it again.");
  if (png.length > MAX_SIGNATURE_CHARS) throw new Error("The signature image is too large. Clear it and draw it again.");
  if (!name) throw new Error("Enter the name of the person signing.");
  if (!SIGNATORY_RELATIONSHIPS.some((item) => item.value === relationship)) {
    throw new Error("Choose how this person is connected to the claim.");
  }
  return { name, relationship, png, skipReason: null };
}
