/**
 * Outstanding on the money table.
 * Per claim, per head: the agreed figure if there is one, otherwise the confirmed claimed figure, minus what has been received.
 * A head total is the sum of those claim figures. It is never one column total minus another.
 */

export type OutstandingBasis = "agreed" | "confirmed_claimed" | "none";

export type OutstandingLineInput = {
  claimId: string;
  fileReference: string;
  head: string;
  claimedPence: number;
  offeredPence: number;
  agreedPence: number;
  receivedPence: number;
  /** Provisional, "Start date missing", or no figure is not a confirmed claimed figure. */
  claimedConfirmed: boolean;
};

export type LineOutstanding = {
  basis: OutstandingBasis;
  comparisonPence: number | null;
  outstandingPence: number | null;
  /** Received is above the comparison figure. The amount is not clamped. */
  overpayment: boolean;
  /** There is an agreed figure and received is higher than that figure. */
  receivedExceedsAgreed: boolean;
};

export type OverpaymentNote = {
  claimId: string;
  fileReference: string;
  head: string;
  agreedPence: number;
  claimedPence: number;
  receivedPence: number;
  comparisonPence: number;
  basis: "agreed" | "confirmed_claimed";
  overpaidPence: number;
};

export type HeadMoneyRow = {
  head: string;
  claimedPence: number;
  confirmedClaimedPence: number;
  provisionalClaimedPence: number;
  offeredPence: number;
  agreedPence: number;
  receivedPence: number;
  /** Null when no claim on this head has an agreed or confirmed claimed figure. */
  outstandingPence: number | null;
  overpayments: OverpaymentNote[];
};

export function lineOutstanding(line: OutstandingLineInput): LineOutstanding {
  const agreed = Math.trunc(line.agreedPence || 0);
  const claimed = Math.trunc(line.claimedPence || 0);
  const received = Math.trunc(line.receivedPence || 0);
  const receivedExceedsAgreed = agreed > 0 && received > agreed;
  if (agreed > 0) {
    return {
      basis: "agreed",
      comparisonPence: agreed,
      outstandingPence: agreed - received,
      overpayment: received > agreed,
      receivedExceedsAgreed,
    };
  }
  if (line.claimedConfirmed && claimed > 0) {
    return {
      basis: "confirmed_claimed",
      comparisonPence: claimed,
      outstandingPence: claimed - received,
      overpayment: received > claimed,
      receivedExceedsAgreed: false,
    };
  }
  return {
    basis: "none",
    comparisonPence: null,
    outstandingPence: null,
    overpayment: false,
    receivedExceedsAgreed: false,
  };
}

export function summariseHeads(lines: OutstandingLineInput[]): {
  heads: HeadMoneyRow[];
  confirmed: { claimedPence: number; offeredPence: number; agreedPence: number; receivedPence: number; outstandingPence: number | null };
  provisional: { claimedPence: number };
  overpayments: OverpaymentNote[];
} {
  const byHead = new Map<string, HeadMoneyRow>();
  const overpayments: OverpaymentNote[] = [];
  let confirmedClaimed = 0;
  let provisionalClaimed = 0;
  let offered = 0;
  let agreed = 0;
  let received = 0;
  let outstanding = 0;
  let anyOutstanding = false;

  for (const line of lines) {
    const row = byHead.get(line.head) ?? {
      head: line.head,
      claimedPence: 0,
      confirmedClaimedPence: 0,
      provisionalClaimedPence: 0,
      offeredPence: 0,
      agreedPence: 0,
      receivedPence: 0,
      outstandingPence: null,
      overpayments: [],
    };
    const claimed = Math.trunc(line.claimedPence || 0);
    const lineOffered = Math.trunc(line.offeredPence || 0);
    const lineAgreed = Math.trunc(line.agreedPence || 0);
    const lineReceived = Math.trunc(line.receivedPence || 0);
    row.claimedPence += claimed;
    row.offeredPence += lineOffered;
    row.agreedPence += lineAgreed;
    row.receivedPence += lineReceived;
    offered += lineOffered;
    agreed += lineAgreed;
    received += lineReceived;
    if (line.claimedConfirmed && claimed > 0) {
      row.confirmedClaimedPence += claimed;
      confirmedClaimed += claimed;
    } else if (claimed > 0) {
      row.provisionalClaimedPence += claimed;
      provisionalClaimed += claimed;
    }
    const worked = lineOutstanding(line);
    if (worked.outstandingPence !== null) {
      row.outstandingPence = (row.outstandingPence ?? 0) + worked.outstandingPence;
      outstanding += worked.outstandingPence;
      anyOutstanding = true;
    }
    if (worked.overpayment && worked.comparisonPence !== null && worked.basis !== "none") {
      const note: OverpaymentNote = {
        claimId: line.claimId,
        fileReference: line.fileReference,
        head: line.head,
        agreedPence: lineAgreed,
        claimedPence: claimed,
        receivedPence: lineReceived,
        comparisonPence: worked.comparisonPence,
        basis: worked.basis,
        overpaidPence: lineReceived - worked.comparisonPence,
      };
      row.overpayments.push(note);
      overpayments.push(note);
    }
    byHead.set(line.head, row);
  }

  return {
    heads: [...byHead.values()],
    confirmed: {
      claimedPence: confirmedClaimed,
      offeredPence: offered,
      agreedPence: agreed,
      receivedPence: received,
      outstandingPence: anyOutstanding ? outstanding : null,
    },
    provisional: { claimedPence: provisionalClaimed },
    overpayments,
  };
}

/** Hire and storage claimed figures are confirmed only when the end (and, for storage, the start) is on the file. */
export function claimedFigureIsConfirmed(input: {
  head: string;
  claimedPence: number;
  description?: string | null;
  hireUnconfirmed?: boolean;
  storageUnconfirmed?: boolean;
  storageStartMissing?: boolean;
}): boolean {
  const claimed = Math.trunc(input.claimedPence || 0);
  if (claimed <= 0) return false;
  const description = String(input.description || "");
  if (/start date missing/i.test(description)) return false;
  if (/provisional/i.test(description)) return false;
  if ((input.head === "hire" || input.head === "credit_hire") && input.hireUnconfirmed) return false;
  if (input.head === "storage" && (input.storageStartMissing || input.storageUnconfirmed)) return false;
  return true;
}
