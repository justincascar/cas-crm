import { CAS_LEGAL_SIGNOFF_NOTICE, CAS_TEMPLATE_NOTICE, OPERATIONAL_DRAFT_NOTICE } from "./correspondence";

/**
 * R42: notes for staff about where a document's wording came from. They are shown on the screen above the sheet
 * (print-hidden) and never inside the letter, its printout, an email or an attachment. Documents made before R42 had
 * them inside the letter; these helpers take them out wherever a stored letter is shown, printed or sent.
 */
export const SCREEN_ONLY_NOTICES = [CAS_TEMPLATE_NOTICE, CAS_LEGAL_SIGNOFF_NOTICE, OPERATIONAL_DRAFT_NOTICE] as const;

/** The CRM's own working letters, not one of CAS's supplied templates. */
export const OPERATIONAL_TEMPLATE_KEYS: ReadonlySet<string> = new Set(["repair_commencement", "liability_chaser"]);

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const htmlPatterns = SCREEN_ONLY_NOTICES.flatMap((notice) =>
  [...new Set([notice, escapeHtml(notice), notice.replace(/'/g, "&#x27;")])].map(
    (form) => new RegExp(`\\s*<p class="text-xs">\\s*${escapeRegExp(form)}\\s*</p>`, "g"),
  ),
);

export function withoutScreenNotices(html: string): string {
  let out = html;
  for (const pattern of htmlPatterns) out = out.replace(pattern, "");
  return out;
}

/**
 * A draft invoice says so on paper. Invoices made before R42 were headed "Invoice — …" with the draft wording only in a
 * note for staff, which no longer prints.
 */
export function withDraftInvoiceHeading(html: string, templateKey: string | null | undefined): string {
  if (!String(templateKey || "").startsWith("draft_invoice")) return html;
  return html.replace(/<h2>Invoice — /g, "<h2>Draft invoice — ");
}

/** A stored document as it may leave the CRM: without the notes above or any note for staff inside it. */
export function forSending(html: string, templateKey?: string | null): string {
  return withDraftInvoiceHeading(withoutScreenNotices(html), templateKey).replace(/\s*<p class="internal-note">[\s\S]*?<\/p>/g, "");
}

export function withoutScreenNoticesText(text: string): string {
  let out = text;
  for (const notice of SCREEN_ONLY_NOTICES) out = out.replaceAll(notice, "");
  return out.replace(/\n{3,}/g, "\n\n").trimEnd();
}

export function containsScreenNotice(text: string): boolean {
  return SCREEN_ONLY_NOTICES.some((notice) => text.includes(notice) || text.includes(escapeHtml(notice)));
}
