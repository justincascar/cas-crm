type DocLike = { kind?: string | number | null; template_key?: string | number | null; document_type?: string | number | null };

const KIND_WORDS: Record<string, string> = {
  agreement: "Agreement",
  letter: "Letter",
  email: "Email",
  file: "File",
  photograph: "Photograph",
  engineer_report: "Engineer's report",
  estimate: "Estimate",
  schedule: "Schedule",
  invoice: "Invoice",
  pack: "Pack",
};

/** R45: the kind of document in plain words, never a stored code such as "hire_agreement". */
export function documentKindLabel(doc: DocLike): string {
  const key = String(doc.template_key || "");
  const type = String(doc.document_type || "");
  if (key.startsWith("draft_invoice")) return "Invoice (draft)";
  if (key === "hire_agreement" || type === "hire_agreement") return "Hire agreement";
  if (type === "signed_hire_agreement") return "Signed hire agreement";
  if (key === "recovery_storage_agreement" || key === "storage_recovery") return "Storage & Recovery Agreement";
  if (type === "signed_storage_recovery_agreement") return "Signed Storage & Recovery Agreement";
  if (key.startsWith("hire_pack")) return "Hire Pack";
  const kind = String(doc.kind || "");
  if (KIND_WORDS[kind]) return KIND_WORDS[kind];
  const words = (kind || type || "document").replaceAll("_", " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
