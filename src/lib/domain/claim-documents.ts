/** Types a staff member can put on a claim file. Fleet V5Cs imported for the yard stay on type "V5C". */
export const CLAIM_DOCUMENT_TYPES = [
  { value: "v5c_client", label: "V5C — client's vehicle", vehicle: "client" },
  { value: "v5c_cas", label: "V5C — CAS vehicle", vehicle: "fleet" },
  { value: "driving_licence", label: "Driving licence", vehicle: "none" },
  { value: "bank_statements", label: "Bank statements", vehicle: "none" },
  { value: "insurance_certificate", label: "Insurance certificate", vehicle: "client" },
  { value: "signed_hire_agreement", label: "Signed hire agreement", vehicle: "fleet" },
  { value: "engineer_report", label: "Engineer's report", vehicle: "none" },
  { value: "satisfaction_note", label: "Satisfaction note", vehicle: "none" },
  { value: "correspondence", label: "Correspondence", vehicle: "none" },
  { value: "other", label: "Other", vehicle: "optional" },
] as const;

export type ClaimDocumentType = (typeof CLAIM_DOCUMENT_TYPES)[number]["value"];

export const DOCUMENT_PURPOSES = [
  {
    id: "client_papers",
    label: "Papers named in the client welcome letter",
    detail: "V5C for the client's vehicle, insurance certificate and driving licence.",
    types: ["v5c_client", "insurance_certificate", "driving_licence"] as const,
  },
  {
    id: "bank_statements",
    label: "Asked for with the hire agreement",
    detail: "A short statement of means and the last three months' bank statements. The hire agreement asks for these before the replacement vehicle goes out.",
    types: ["bank_statements"] as const,
  },
  {
    id: "payment_request",
    label: "Payment request pack",
    detail:
      "The signed hire agreement and the engineer's report, named for a later payment request. Nothing on this page is attached to an email. Repair invoice and basic hire-rate evidence are named in the workflow map and are not separate types yet — store those as Other.",
    types: ["signed_hire_agreement", "engineer_report"] as const,
  },
] as const;

export const MAX_CLAIM_DOCUMENT_BYTES = 12 * 1024 * 1024;

export function claimDocumentTypeLabel(value: string | null | undefined): string {
  return CLAIM_DOCUMENT_TYPES.find((item) => item.value === value)?.label || "";
}

export function isClaimDocumentType(value: string): value is ClaimDocumentType {
  return CLAIM_DOCUMENT_TYPES.some((item) => item.value === value);
}

export function claimDocumentMime(filename: string, mimeType: string): string {
  const mime = (mimeType || "").toLowerCase();
  const lower = (filename || "").toLowerCase();
  if (mime === "application/pdf" || lower.endsWith(".pdf")) return "application/pdf";
  if (mime === "image/jpeg" || mime === "image/jpg" || mime === "image/pjpeg" || lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (mime === "image/png" || lower.endsWith(".png")) return "image/png";
  if (mime === "image/webp" || lower.endsWith(".webp")) return "image/webp";
  if (mime === "image/gif" || lower.endsWith(".gif")) return "image/gif";
  throw new Error("Store a PDF or a photograph (JPEG, PNG, WebP or GIF).");
}
