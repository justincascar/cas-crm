import { rebuildDueList } from "./retention";

const DAY_MS = 24 * 60 * 60 * 1000;

let started = false;

/**
 * Builds the "Due for deletion" list when the server starts, then once a day (J15). It deletes nothing: Justin
 * approves each batch on the Retention page. The page check sets CAS_PAGE_CHECK so this does not run then.
 */
export function startRetentionSchedule() {
  if (started) return;
  if (process.env.CAS_PAGE_CHECK === "1") return;
  started = true;
  const pass = () => {
    try {
      rebuildDueList();
    } catch {
      /* A failed pass leaves the previous list in place. */
    }
  };
  pass();
  const timer = setInterval(pass, DAY_MS);
  timer.unref?.();
}
