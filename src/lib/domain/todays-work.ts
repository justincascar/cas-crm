import type { DueTone } from "./due-wording";

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
};

export type TodaysWorkRow = {
  claimId: string;
  fileReference: string;
  clientName: string;
  handlerName: string;
  lead: DeskWorkItem;
  rest: DeskWorkItem[];
};

function byUrgency(a: DeskWorkItem, b: DeskWorkItem): number {
  if (a.sortDays !== b.sortDays) return b.sortDays - a.sortDays;
  const file = a.fileReference.localeCompare(b.fileReference);
  if (file !== 0) return file;
  return a.item.localeCompare(b.item);
}

/** One row per claim. The lead is that claim's most overdue item. Due today follows overdue. Future follows due today. */
export function todaysWorkRows(items: DeskWorkItem[]): TodaysWorkRow[] {
  const byClaim = new Map<string, DeskWorkItem[]>();
  for (const item of items) {
    const list = byClaim.get(item.claimId) ?? [];
    list.push(item);
    byClaim.set(item.claimId, list);
  }
  const rows: TodaysWorkRow[] = [];
  for (const list of byClaim.values()) {
    const sorted = [...list].sort(byUrgency);
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
  rows.sort((a, b) => byUrgency(a.lead, b.lead));
  return rows;
}

export function nothingDueLine(names: string[]): string | null {
  if (names.length === 0) return null;
  return `Nothing due: ${names.join(", ")}`;
}
