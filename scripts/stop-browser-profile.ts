import { spawnSync } from "node:child_process";

/**
 * Edge hands its windows to helper processes that outlive the one the check started, so stopping that one
 * process leaves the rest running and holding a debugging port. On Windows this stops every Edge process
 * using this run's own temporary profile folder, and nothing else.
 */
export function stopBrowserProfile(userDataDir: string) {
  if (process.platform !== "win32") return;
  const folder = userDataDir.replaceAll("'", "''");
  const script = `Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" | Where-Object { $_.CommandLine -like '*${folder}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore", timeout: 20_000 });
}
