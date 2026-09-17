/** All money is stored as integer pence. Never add claimed + agreed + received into one "total". */

export type MoneyPence = number;

export function pence(pounds: number): MoneyPence {
  return Math.round(pounds * 100);
}

export function vatOnNet(netPence: MoneyPence, rate = 0.2): MoneyPence {
  return Math.round(netPence * rate);
}

export function grossFromNet(netPence: MoneyPence, rate = 0.2): {
  net: MoneyPence;
  vat: MoneyPence;
  gross: MoneyPence;
} {
  const vat = vatOnNet(netPence, rate);
  return { net: netPence, vat, gross: netPence + vat };
}

export function formatGbp(penceValue: MoneyPence | null | undefined): string {
  const value = (penceValue ?? 0) / 100;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(value);
}

export type FinancialTotals = {
  claimed: MoneyPence;
  offered: MoneyPence;
  agreed: MoneyPence;
  received: MoneyPence;
};

export function sumDistinctHeads(
  lines: Array<{
    claimed_pence: number;
    offered_pence: number;
    agreed_pence: number;
    received_pence: number;
  }>,
): FinancialTotals {
  return lines.reduce(
    (acc, line) => ({
      claimed: acc.claimed + (line.claimed_pence || 0),
      offered: acc.offered + (line.offered_pence || 0),
      agreed: acc.agreed + (line.agreed_pence || 0),
      received: acc.received + (line.received_pence || 0),
    }),
    { claimed: 0, offered: 0, agreed: 0, received: 0 },
  );
}

export function offerIsNotReceipt(offered: MoneyPence, received: MoneyPence): boolean {
  return offered > 0 && received === 0;
}
