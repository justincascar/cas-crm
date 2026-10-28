/** The device and network address recorded with a signature. Taken from the request, never typed. */
export function requestDevice(request: Request): { device: string; ip: string } {
  const device = request.headers.get("user-agent") || "";
  const forwarded = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "";
  return { device, ip: forwarded.split(",")[0].trim() || "local network" };
}
