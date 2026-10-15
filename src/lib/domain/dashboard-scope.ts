export const DASHBOARD_SCOPE_COOKIE = "cas_dashboard_scope";

export type DashboardScope = "mine" | "all";

export function parseDashboardScope(value: string | null | undefined): DashboardScope | null {
  if (value === "mine" || value === "all") return value;
  return null;
}

/** Justin's login opens on every claim. Every other handler opens on their own. */
export function defaultDashboardScope(staff: { id: string; username: string }): DashboardScope {
  if (staff.id === "staff-justin" || staff.username.trim().toLowerCase() === "justin") return "all";
  return "mine";
}

/** The saved choice names the person, so the next sign-in on this PC keeps their own default. */
export function scopeCookieValue(staffId: string, scope: DashboardScope): string {
  return `${staffId}:${scope}`;
}

export function scopeFromCookie(staffId: string, cookie: string | null | undefined): DashboardScope | null {
  if (!cookie) return null;
  const prefix = `${staffId}:`;
  if (!cookie.startsWith(prefix)) return null;
  return parseDashboardScope(cookie.slice(prefix.length));
}

export function resolveDashboardScope(
  staff: { id: string; username: string },
  requested: string | null | undefined,
  cookie: string | null | undefined,
): DashboardScope {
  return parseDashboardScope(requested) || scopeFromCookie(staff.id, cookie) || defaultDashboardScope(staff);
}
