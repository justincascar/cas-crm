export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.CAS_PAGE_CHECK === "1") return;
  const { startWaitReleaseSchedule } = await import("./lib/db/wait-release-schedule");
  startWaitReleaseSchedule();
  const { startRetentionSchedule } = await import("./lib/db/retention-schedule");
  startRetentionSchedule();
  const { startAutomaticChasers } = await import("./lib/db/auto-chasers");
  startAutomaticChasers();
}
