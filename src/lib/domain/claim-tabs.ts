/** Where each old claim address sits under the seven tabs. */

export const CLAIM_TAB_KEYS = ["steps", "details", "hire", "money", "documents", "messages", "history"] as const;

export type ClaimTabKey = (typeof CLAIM_TAB_KEYS)[number];

export function claimTabHref(claimId: string, tab: ClaimTabKey): string {
  if (tab === "steps") return `/claims/${claimId}`;
  return `/claims/${claimId}/${tab}`;
}

export function workScreenTabPath(claimId: string, screen: string): string {
  if (screen === "comms") return `/claims/${claimId}/messages`;
  if (screen === "history") return `/claims/${claimId}/history`;
  if (screen === "storage" || screen === "recovery") return `/claims/${claimId}/money/${screen}`;
  return `/claims/${claimId}/details/${screen}`;
}

export function headTabPath(claimId: string, head: string): string {
  return `/claims/${claimId}/money/${head}`;
}

/** Which of the seven tabs is showing. Old addresses count as their new tab. */
export function claimTabFromPath(pathname: string, claimId: string): ClaimTabKey {
  const path = (pathname.split("?")[0] || "").replace(/\/$/, "");
  const base = `/claims/${claimId}`;
  if (path === base || path.startsWith(`${base}/steps`)) return "steps";
  if (path === `${base}/messages` || path.startsWith(`${base}/messages/`) || path.startsWith(`${base}/work/comms`)) return "messages";
  if (path === `${base}/history` || path.startsWith(`${base}/history/`)) return "history";
  if (path === `${base}/money` || path.startsWith(`${base}/money/`) || path.includes("/heads/")) return "money";
  if (
    path === `${base}/documents` ||
    path.startsWith(`${base}/documents/`) ||
    path === `${base}/repair` ||
    path.startsWith(`${base}/repair/`)
  ) {
    return "documents";
  }
  if (
    path === `${base}/hire` ||
    path.startsWith(`${base}/hire/`) ||
    path === `${base}/prehire` ||
    path.startsWith(`${base}/prehire/`) ||
    path === `${base}/handover` ||
    path.startsWith(`${base}/handover/`) ||
    path === `${base}/hire-pack` ||
    path.startsWith(`${base}/hire-pack/`) ||
    path === `${base}/financial` ||
    path.startsWith(`${base}/financial/`)
  ) {
    return "hire";
  }
  if (
    path === `${base}/details` ||
    path.startsWith(`${base}/details/`) ||
    path === `${base}/vehicles` ||
    path.startsWith(`${base}/vehicles/`) ||
    path.startsWith(`${base}/work/`)
  ) {
    return "details";
  }
  return "steps";
}
