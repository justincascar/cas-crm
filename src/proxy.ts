import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";

/**
 * J15 cross-site request check: a form or script post must come from the CRM's own pages. A browser always sends
 * Origin on a post, so a different (or "null") origin is refused before any route runs. Session cookies are also
 * SameSite=Lax, so another site cannot post with them.
 */
function crossSitePost(request: NextRequest): boolean {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return false;
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  // A page that sends no referrer (the client form) makes the browser send Origin "null" on its own posts. That is
  // accepted only when the browser also says the post came from this site.
  if (origin === "null") return site !== "same-origin";
  try {
    return new URL(origin).host !== request.headers.get("host");
  } catch {
    return true;
  }
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (crossSitePost(request)) {
    return new NextResponse("Refused: this was not sent from a CAS CRM page.", { status: 403 });
  }
  // The client signing page and the client form are reached from a link and have no CAS login.
  const isLogin =
    pathname === "/login" ||
    pathname === "/login/submit" ||
    pathname === "/login/code" ||
    pathname === "/login/code/submit" ||
    pathname === "/login/setup" ||
    pathname === "/privacy" ||
    /^\/sign\/[A-Za-z0-9_-]+(\/submit)?$/.test(pathname) ||
    /^\/c\/[A-Za-z0-9_-]+(\/save)?$/.test(pathname);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-cas-pathname", pathname);
  if (isLogin) {
    requestHeaders.set("x-cas-public", "1");
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    const login = new URL("/login", request.url);
    const next = `${pathname}${request.nextUrl.search}`;
    if (next && next !== "/") {
      login.searchParams.set("next", next);
    }
    return NextResponse.redirect(login);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/webpack-hmr|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
