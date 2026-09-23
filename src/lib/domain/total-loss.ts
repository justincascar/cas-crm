/** Engineer's total-loss figures. Empty is not zero. Nothing here writes an agreed or paid amount. */

export type InsurerSalvageInterest = "no_interest" | "takes_interest";
export type SalvageDisposal = "sold" | "returned" | "bought_by_cas";

export type TotalLossFigures = {
  pavPence: number | null;
  salvagePence: number | null;
  interest: InsurerSalvageInterest | null;
  insurerOfferedPence: number | null;
  disposal: SalvageDisposal | null;
  saleProceedsPence: number | null;
  returnedOn: string | null;
  customerChargePence: number | null;
  casPurchasePence: number | null;
};

export type TotalLossSuggestion =
  | { kind: "hidden" }
  | { kind: "incomplete" }
  | { kind: "suggestion"; pence: number };

export function optionalPoundsToPence(raw: string | null | undefined): number | null {
  const text = (raw || "").replace(/£/g, "").replace(/,/g, "").trim();
  if (!text) return null;
  const amount = Number.parseFloat(text);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Enter a money amount in pounds, or leave the box empty.");
  return Math.round(amount * 100);
}

/** A suggestion exists only when the insurer has no interest and both engineer's figures are present. */
export function totalLossSuggestion(input: {
  pavPence: number | null;
  salvagePence: number | null;
  interest: InsurerSalvageInterest | null;
}): TotalLossSuggestion {
  if (input.interest !== "no_interest") return { kind: "hidden" };
  if (input.pavPence == null || input.salvagePence == null) return { kind: "incomplete" };
  return { kind: "suggestion", pence: input.pavPence - input.salvagePence };
}

export function disposalApplies(interest: InsurerSalvageInterest | null): boolean {
  return interest === "no_interest";
}

/** Sale proceeds minus the engineer's salvage figure. Null until both exist. Not written into agreed or paid. */
export function salvageSaleVariance(salvagePence: number | null, saleProceedsPence: number | null): number | null {
  if (salvagePence == null || saleProceedsPence == null) return null;
  return saleProceedsPence - salvagePence;
}

export function figuresIncomplete(input: { pavPence: number | null; salvagePence: number | null }): boolean {
  return input.pavPence == null || input.salvagePence == null;
}
