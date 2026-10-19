import { releaseDueWaits } from "./desk-work";

const HALF_HOUR_MS = 30 * 60 * 1000;

let started = false;

/**
 * Restores an expired wait and resumes its paused chase.
 * This runs when the server starts, then on a timer. It is not called from a page load.
 * The page check sets CAS_PAGE_CHECK so this pass does not run while pages are being opened.
 */
export function startWaitReleaseSchedule() {
  if (started) return;
  if (process.env.CAS_PAGE_CHECK === "1") return;
  started = true;
  const pass = () => {
    try {
      releaseDueWaits();
    } catch {
      /* A failed pass does not rewrite other fields. */
    }
  };
  pass();
  const timer = setInterval(pass, HALF_HOUR_MS);
  timer.unref?.();
}

/** The same pass the timer runs. Tests call this directly. It is not a page render. */
export function runScheduledWaitRelease(today?: string) {
  releaseDueWaits(today);
}
