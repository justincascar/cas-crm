import type { DueTone } from "./due-wording";

export type WorkTier = 1 | 2 | 3;

export type DeskWorkItem = {
  id: string;
  claimId: string;
  fileReference: string;
  clientName: string;
  handlerName: string;
  item: string;
  wording: string;
  tone: DueTone;
  sortDays: number;
  tier: WorkTier;
  /** Daily hire plus storage rate, in pence, while that charge is still running. */
  runningDailyPence: number | null;
  /** Real days with no repair progress. Used to order tier 2. */
  progressDays: number | null;
  chaseKind: string | null;
  prepareChase: boolean;
  recordStep: boolean;
  waitVersion: string;
};

export type TodaysWorkRow = {
  claimId: string;
  fileReference: string;
  clientName: string;
  handlerName: string;
  lead: DeskWorkItem;
  rest: DeskWorkItem[];
};

export function tierLabel(tier: WorkTier): string {
  if (tier === 1) return "Deadline";
  if (tier === 2) return "Money running";
  return "Other";
}

/** The item title does not also say Overdue. The when column carries "Overdue by [n] days". */
export function deskItemTitle(title: string): string {
  const stripped = title
    .replace(/\boverdue\b\s*:\s*/gi, "")
    .replace(/\boverdue\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+—/g, " —")
    .replace(/^[\s:—-]+/, "")
    .trim();
  return stripped;
}

export function runningScore(item: Pick<DeskWorkItem, "runningDailyPence" | "progressDays">): number {
  return Math.max(0, item.runningDailyPence || 0) * Math.max(0, item.progressDays || 0);
}

/** Tier 1, then tier 2 by daily cost × days with no progress, then tier 3 by days overdue. */
export function compareDeskItems(a: DeskWorkItem, b: DeskWorkItem): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.tier === 2) {
    const score = runningScore(b) - runningScore(a);
    if (score !== 0) return score;
  } else if (a.sortDays !== b.sortDays) {
    return b.sortDays - a.sortDays;
  }
  const file = a.fileReference.localeCompare(b.fileReference);
  if (file !== 0) return file;
  return a.item.localeCompare(b.item);
}

/** One row per claim. The lead is that claim's highest-tier item. */
export function todaysWorkRows(items: DeskWorkItem[]): TodaysWorkRow[] {
  const byClaim = new Map<string, DeskWorkItem[]>();
  for (const item of items) {
    const list = byClaim.get(item.claimId) ?? [];
    list.push(item);
    byClaim.set(item.claimId, list);
  }
  const rows: TodaysWorkRow[] = [];
  for (const list of byClaim.values()) {
    const sorted = [...list].sort(compareDeskItems);
    const lead = sorted[0];
    if (!lead) continue;
    rows.push({
      claimId: lead.claimId,
      fileReference: lead.fileReference,
      clientName: lead.clientName,
      handlerName: lead.handlerName,
      lead,
      rest: sorted.slice(1),
    });
  }
  rows.sort((a, b) => compareDeskItems(a.lead, b.lead));
  return rows;
}

export function nothingDueLine(names: string[]): string | null {
  if (names.length === 0) return null;
  return `Nothing due: ${names.join(", ")}`;
}

export function blankDeskItem(
  partial: Omit<DeskWorkItem, "tier" | "runningDailyPence" | "progressDays" | "chaseKind" | "prepareChase" | "recordStep" | "waitVersion"> &
    Partial<Pick<DeskWorkItem, "tier" | "runningDailyPence" | "progressDays" | "chaseKind" | "prepareChase" | "recordStep" | "waitVersion">>,
): DeskWorkItem {
  return {
    tier: 3,
    runningDailyPence: null,
    progressDays: null,
    chaseKind: null,
    prepareChase: false,
    recordStep: true,
    waitVersion: "",
    ...partial,
    item: deskItemTitle(partial.item),
  };
}
