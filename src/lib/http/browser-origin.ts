/** The dev server rewrites request.url to localhost. Redirects must stay on the address the phone opened. */
export function browserOrigin(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const host = forwarded.split(",")[0].trim();
  const hostname = host.split(":")[0];
  const onLan = hostname === "localhost" || hostname === "127.0.0.1" || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname);
  if (!onLan || !host) return new URL(request.url).origin;
  const proto = (request.headers.get("x-forwarded-proto") || "http").split(",")[0].trim() === "https" ? "https" : "http";
  return `${proto}://${host}`;
}
