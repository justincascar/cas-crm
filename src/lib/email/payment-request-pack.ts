import { claimDocumentTypeLabel } from "../domain/claim-documents";

/**
 * There is no email template titled "Payment request".
 * The hire pack cover letter is generated on its own and, once stored, is the letter in this pack.
 * The prepared repair-invoice and total-loss settlement chases pre-tick this pack.
 * Payment chase 1 and 2 are no longer free-standing composer templates; those keys still select the same pack if an older draft is opened.
 */
export const PAYMENT_REQUEST_EMAIL_TEMPLATE_KEYS = [
  "payment_chase_1",
  "payment_chase_2",
  "repair_payment_chase",
  "settlement_payment_chase",
] as const;

/** Payment chase 1 — first reminder. Callers that name that template still use this. */
export const PAYMENT_REQUEST_EMAIL_TEMPLATE_KEY = PAYMENT_REQUEST_EMAIL_TEMPLATE_KEYS[0];

export function isPaymentRequestEmailTemplate(templateKey: string): boolean {
  return (PAYMENT_REQUEST_EMAIL_TEMPLATE_KEYS as readonly string[]).includes(templateKey);
}

/** Stored hire-pack cover letter. Compose does not generate one. */
export const PAYMENT_REQUEST_LETTER_TEMPLATE_KEY = "hire_pack_cover";

export const CAS_INSURANCE_DOCUMENT_TYPE = "cas_insurance_certificate";

const HIRE_AGREEMENT_TEMPLATE_KEY = "hire_agreement";
const HIRE_AGREEMENT_DOCUMENT_TYPE = "hire_agreement";
const SIGNED_HIRE_AGREEMENT_TYPE = "signed_hire_agreement";

export const PAYMENT_REQUEST_PACK_MISSING = {
  letter: "Payment request letter — not on file",
  signedHireAgreement: "Signed hire agreement — not on file",
  clientV5c: `${claimDocumentTypeLabel("v5c_client")} — not on file`,
  drivingLicence: `${claimDocumentTypeLabel("driving_licence")} — not on file`,
  clientInsurance: `${claimDocumentTypeLabel("insurance_certificate")} — not on file`,
  hireVehicleV5c: `${claimDocumentTypeLabel("v5c_cas")} — not on file`,
  casInsurance: "CAS's own insurance certificate — not set up",
} as const;

export type PackDocument = {
  id?: string | number | null;
  title?: string | number | null;
  document_type?: string | number | null;
  template_key?: string | number | null;
  version?: string | number | null;
  created_at?: string | number | null;
  stored_relpath?: string | number | null;
  body_html?: string | number | null;
  byte_size?: string | number | null;
  signed?: string | number | null;
  replaces_document_id?: string | number | null;
};

export type PaymentRequestPack = {
  applies: boolean;
  selectedIds: string[];
  missing: string[];
};

function text(value: string | number | null | undefined): string {
  return String(value ?? "").trim();
}

function hasStoredContent(row: PackDocument): boolean {
  if (!text(row.id)) return false;
  if (text(row.stored_relpath)) return true;
  return text(row.body_html) !== "";
}

/** The copy that has not been replaced, then the highest version, then the latest. */
export function currentStoredDocument(rows: PackDocument[]): PackDocument | null {
  const live = rows.filter(hasStoredContent);
  const replaced = new Set(live.map((row) => text(row.replaces_document_id)).filter(Boolean));
  const heads = live.filter((row) => !replaced.has(text(row.id)));
  if (heads.length === 0) return null;
  heads.sort((a, b) => {
    const version = (Number(b.version) || 1) - (Number(a.version) || 1);
    if (version !== 0) return version;
    const created = text(b.created_at).localeCompare(text(a.created_at));
    if (created !== 0) return created;
    return text(b.id).localeCompare(text(a.id));
  });
  return heads[0];
}

function ofType(rows: PackDocument[], documentType: string): PackDocument | null {
  return currentStoredDocument(rows.filter((row) => text(row.document_type) === documentType));
}

function isSignedHireAgreement(row: PackDocument): boolean {
  if (text(row.document_type) === SIGNED_HIRE_AGREEMENT_TYPE) return true;
  const hire =
    text(row.document_type) === HIRE_AGREEMENT_DOCUMENT_TYPE || text(row.template_key) === HIRE_AGREEMENT_TEMPLATE_KEY;
  return hire && Number(row.signed) === 1;
}

function select(rows: PackDocument[], companyDocuments: PackDocument[]): { selectedIds: string[]; missing: string[] } {
  const selectedIds: string[] = [];
  const missing: string[] = [];
  const take = (row: PackDocument | null, gap: string) => {
    const id = text(row?.id);
    if (row && id) selectedIds.push(id);
    else missing.push(gap);
  };

  take(
    currentStoredDocument(rows.filter((row) => text(row.template_key) === PAYMENT_REQUEST_LETTER_TEMPLATE_KEY)),
    PAYMENT_REQUEST_PACK_MISSING.letter,
  );
  take(currentStoredDocument(rows.filter(isSignedHireAgreement)), PAYMENT_REQUEST_PACK_MISSING.signedHireAgreement);
  take(ofType(rows, "v5c_client"), PAYMENT_REQUEST_PACK_MISSING.clientV5c);
  take(ofType(rows, "driving_licence"), PAYMENT_REQUEST_PACK_MISSING.drivingLicence);
  take(ofType(rows, "insurance_certificate"), PAYMENT_REQUEST_PACK_MISSING.clientInsurance);
  take(ofType(rows, "v5c_cas"), PAYMENT_REQUEST_PACK_MISSING.hireVehicleV5c);
  take(
    currentStoredDocument(companyDocuments.filter((row) => text(row.document_type) === CAS_INSURANCE_DOCUMENT_TYPE)),
    PAYMENT_REQUEST_PACK_MISSING.casInsurance,
  );
  return { selectedIds, missing };
}

/** Ids to pre-tick, and the pack lines that are not stored. Does not send and does not generate a letter. */
export function paymentRequestPack(input: {
  templateKey: string;
  claimDocuments: PackDocument[];
  companyDocuments?: PackDocument[];
}): PaymentRequestPack {
  if (!isPaymentRequestEmailTemplate(input.templateKey)) {
    return { applies: false, selectedIds: [], missing: [] };
  }
  const chosen = select(input.claimDocuments, input.companyDocuments ?? []);
  return { applies: true, selectedIds: chosen.selectedIds, missing: chosen.missing };
}
