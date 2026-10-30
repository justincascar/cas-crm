import { formatUkDate, londonTodayIso, nowUtcIso } from "../dates";
import { CAS_COMPANY } from "../documents/cas-hire-terms";
import { storageRecoverySignedLine, storageRecoveryState } from "./storage-recovery-signing";
import { cardFeeLabel, listCardFees } from "./card-fees";
import { cardFeeOnAmount, recoveryCardFeePercent } from "./recovery-fee-settings";
import { lineFromNet } from "../domain/recovery-fees";
import { escapeHtml } from "../documents/correspondence";
import { formatGbp } from "../money";
import { recordClaimEvent } from "./chronology";
import { all, get, newId, run } from "./connection";

export const DRAFT_INVOICE_TEMPLATE = "draft_invoice";

/** The money tab's heads and the ledger heads each one invoices. */
export const INVOICE_HEADS: Record<string, { label: string; ledger: string[] }> = {
  recovery: { label: "Recovery", ledger: ["recovery"] },
  storage: { label: "Storage", ledger: ["storage"] },
  hire: { label: "Hire", ledger: ["hire", "credit_hire"] },
  vehicle: { label: "Vehicle damage", ledger: ["repairs", "vehicle_damage"] },
  /** Addressed to the customer, for the recovery and storage charges. */
  customer: { label: "Recovery and storage", ledger: ["recovery", "storage"] },
};

type Line = {
  head_of_loss: string;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  rate_pence: number | null;
  net_pence: number | null;
  vat_pence: number | null;
  gross_pence: number | null;
  claimed_pence: number | null;
  received_pence: number | null;
};

/**
 * A plain draft invoice from the figures on the file. CAS's own invoice template, numbering and VAT number have not
 * been supplied, so the document says so. It is filed on the claim and is not sent.
 */
export function produceDraftInvoice(input: { claimId: string; head: string; actorId: string; payingByCard?: boolean }) {
  const head = INVOICE_HEADS[input.head];
  if (!head) throw new Error("Choose recovery, storage, hire or vehicle damage.");
  const toCustomer = input.head === "customer";
  const claim = get<{ file_reference: string; client_name: string | null; registration: string | null; address_line1: string | null; town: string | null; postcode: string | null }>(
    `SELECT c.file_reference, p.full_name AS client_name, v.registration, p.address_line1, p.town, p.postcode
     FROM claims c LEFT JOIN people p ON p.id = c.client_person_id LEFT JOIN vehicles v ON v.id = c.client_vehicle_id
     WHERE c.id = ?`,
    [input.claimId],
  );
  if (!claim) throw new Error("File not found.");
  const marks = head.ledger.map(() => "?").join(", ");
  const lines = all<Line>(
    `SELECT head_of_loss, description, quantity, unit, rate_pence, net_pence, vat_pence, gross_pence, claimed_pence, received_pence
     FROM financial_lines WHERE claim_id = ? AND head_of_loss IN (${marks}) ORDER BY head_of_loss`,
    [input.claimId, ...head.ledger],
  ).filter((line) => Number(line.claimed_pence || 0) > 0 || Number(line.gross_pence || 0) > 0);
  if (lines.length === 0) throw new Error(`There is no ${head.label.toLowerCase()} charge on the file to invoice.`);
  const insurer = get<{ insurer_name: string | null; insurer_ref: string | null }>(
    `SELECT insurer_name, insurer_ref FROM claim_third_parties WHERE claim_id = ? ORDER BY sequence ASC LIMIT 1`,
    [input.claimId],
  );
  const missing: string[] = [];
  const gap = (value: string | null | undefined, label: string) => {
    const text = String(value || "").trim();
    if (text && text !== "Unknown") return escapeHtml(text);
    missing.push(label);
    return `<span class="gap">[not yet on file]</span>`;
  };
  let net = 0;
  let vat = 0;
  let gross = 0;
  let received = 0;
  const rows = lines
    .map((line) => {
      const lineGross = Number(line.gross_pence ?? line.claimed_pence ?? 0);
      const lineNet = Number(line.net_pence ?? lineGross);
      const lineVat = Number(line.vat_pence ?? lineGross - lineNet);
      net += lineNet;
      vat += lineVat;
      gross += lineGross;
      received += Number(line.received_pence || 0);
      const qty = line.quantity != null && line.rate_pence != null ? `${line.quantity}${line.unit ? ` ${escapeHtml(line.unit)}` : ""} × ${formatGbp(line.rate_pence)}` : "—";
      return `<tr><td>${escapeHtml(String(line.description || head.label))}</td><td>${qty}</td><td>${formatGbp(lineNet)}</td><td>${formatGbp(lineVat)}</td><td>${formatGbp(lineGross)}</td></tr>`;
    })
    .join("");
  // Card fees (R19) are their own lines, never part of the charge above. One already paid by card is shown as received.
  const feeRows: string[] = [];
  for (const fee of listCardFees(input.claimId).filter((row) => head.ledger.includes(row.head))) {
    net += fee.netPence;
    vat += fee.vatPence;
    gross += fee.grossPence;
    received += fee.grossPence;
    feeRows.push(
      `<tr data-card-fee><td>${escapeHtml(`Card fee on the card payment of ${formatGbp(fee.paymentPence)} on ${formatUkDate(fee.recordedAt)} — ${cardFeeLabel(fee)}`)}</td><td>—</td><td>${formatGbp(fee.netPence)}</td><td>${formatGbp(fee.vatPence)}</td><td>${formatGbp(fee.grossPence)}</td></tr>`,
    );
  }
  if (input.payingByCard) {
    // R25: the fee is worked out on the gross amount being paid (the balance due, VAT included), then VAT is added to it.
    const balance = Math.max(0, gross - received);
    const percent = recoveryCardFeePercent();
    const fee = lineFromNet("cardFee", "Card fee", cardFeeOnAmount(balance, percent));
    if (fee.netPence > 0) {
      net += fee.netPence;
      vat += fee.vatPence;
      gross += fee.grossPence;
      feeRows.push(
        `<tr data-card-fee><td>${escapeHtml(`${cardFeeLabel({ percent, basisPence: balance })}, paying by card`)}</td><td>—</td><td>${formatGbp(fee.netPence)}</td><td>${formatGbp(fee.vatPence)}</td><td>${formatGbp(fee.grossPence)}</td></tr>`,
      );
    }
  }
  const today = londonTodayIso();
  // The customer is liable under the Storage & Recovery terms they signed (R17).
  const agreement = storageRecoveryState(input.claimId);
  const html = `<div class="letter">
<p class="internal-note"><strong>Draft invoice.</strong> CAS's invoice template, invoice number and VAT number have not been supplied yet. Not sent.${toCustomer && agreement.status === "not_signed" ? " No signed Storage &amp; Recovery Agreement is on the file yet. Get it signed on the Recovery page before this invoice is used." : ""}${toCustomer && agreement.status === "override" ? ` ${escapeHtml(storageRecoverySignedLine(agreement))}` : ""}</p>
<p>${escapeHtml(CAS_COMPANY.name)}<br>${escapeHtml(CAS_COMPANY.address)}<br>${escapeHtml(CAS_COMPANY.phone)} · ${escapeHtml(CAS_COMPANY.email)}</p>
${toCustomer
    ? `<p>To: ${gap(claim.client_name, "Client name")}<br>${gap([claim.address_line1, claim.town, claim.postcode].filter((part) => part && !/^unknown$/i.test(String(part))).join(", "), "Client's address")}</p>`
    : `<p>To: ${gap(insurer?.insurer_name, "Third-party insurer")}<br>Your reference: ${gap(insurer?.insurer_ref, "Insurer reference")}</p>`}
<p>Our reference: ${escapeHtml(claim.file_reference)}<br>Our client: ${gap(claim.client_name, "Client name")}<br>Vehicle: ${gap(claim.registration, "Client registration")}<br>Date: ${formatUkDate(today)}</p>
<h2>Invoice — ${escapeHtml(head.label)}</h2>
<table><thead><tr><th>Item</th><th>Quantity × rate</th><th>Net</th><th>VAT</th><th>Gross</th></tr></thead><tbody>${rows}${feeRows.join("")}</tbody>
<tfoot><tr><td colspan="2">Total</td><td>${formatGbp(net)}</td><td>${formatGbp(vat)}</td><td>${formatGbp(gross)}</td></tr></tfoot></table>
<p>Received to date: ${formatGbp(received)}. Balance: ${formatGbp(Math.max(0, gross - received))}.</p>
${toCustomer && (agreement.status === "signed" || agreement.status === "covered_by_hire") ? `<p data-sr-reference>${escapeHtml(storageRecoverySignedLine(agreement))} These charges are due under that agreement.</p>` : ""}
</div>`;
  const version = Number(
    get<{ v: number }>(`SELECT COALESCE(MAX(version), 0) AS v FROM documents WHERE claim_id = ? AND template_key = ?`, [
      input.claimId,
      `${DRAFT_INVOICE_TEMPLATE}_${input.head}`,
    ])?.v || 0,
  ) + 1;
  const documentId = newId("doc");
  const at = nowUtcIso();
  const title = toCustomer ? "Draft customer invoice — Recovery and storage" : `Draft invoice — ${head.label}`;
  run(
    `INSERT INTO documents(id, claim_id, title, kind, version, signed, simulated, body_html, template_key, missing_json, created_at)
     VALUES (?, ?, ?, 'letter', ?, 0, 1, ?, ?, ?, ?)`,
    [documentId, input.claimId, title, version, html, `${DRAFT_INVOICE_TEMPLATE}_${input.head}`, JSON.stringify(missing), at],
  );
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "document_generated",
    occurredAt: at,
    details: `${title} (version ${version}) produced from the figures on the file — draft, not sent. Total ${formatGbp(gross)}.${missing.length ? ` Missing: ${missing.join(", ")}` : ""}`,
    actorId: input.actorId,
    channel: "letter",
    documentId,
    source: "system",
  });
  return { documentId, grossPence: gross, missing };
}
