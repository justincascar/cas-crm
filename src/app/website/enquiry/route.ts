import { NextResponse } from "next/server";
import { ENQUIRY_FIELDS, isAllowedWebsiteOrigin, MAX_BODY_BYTES, normaliseOrigin, receiveWebsiteEnquiry, SPAM_TRAP_FIELD } from "@/lib/db/website-enquiries";

/**
 * The public website's "Start your claim" form posts here (J16). There is no staff login, so everything received is
 * untrusted. Only the website address saved in Settings (in development, the local website) may post. A post only ever
 * adds an enquiry for staff to review: it never creates a claim, changes other data or sends anything.
 *
 * The website normally posts with JavaScript and reads the JSON answer. Without JavaScript the browser posts the form
 * itself, and the answer is a redirect back to the website's "received" or "not sent" page.
 */

const NOT_ALLOWED = "Not sent: this address cannot send enquiries to CAS.";

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function json(body: Record<string, unknown>, status: number, origin: string | null, extra: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(origin ? corsHeaders(origin) : {}), ...extra },
  });
}

/** The address the post came from. Behind the hosting's proxy the last entry is the one that proxy saw. */
function clientAddress(request: Request): string {
  const forwarded = (request.headers.get("x-forwarded-for") || "").split(",").map((part) => part.trim()).filter(Boolean);
  return forwarded[forwarded.length - 1] || request.headers.get("x-real-ip") || "unknown";
}

function parseBody(text: string, type: string): Record<string, unknown> | null {
  if (type.startsWith("application/json")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (type.startsWith("application/x-www-form-urlencoded")) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of new URLSearchParams(text)) out[key] = value;
    return out;
  }
  return null;
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  if (!isAllowedWebsiteOrigin(origin)) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, { status: 204, headers: corsHeaders(normaliseOrigin(origin!)!) });
}

export async function POST(request: Request) {
  const rawOrigin = request.headers.get("origin");
  if (!isAllowedWebsiteOrigin(rawOrigin)) return json({ ok: false, message: NOT_ALLOWED }, 403, null);
  const origin = normaliseOrigin(rawOrigin!)!;
  // A form posted without JavaScript goes back to the website's own page; a script gets JSON.
  const navigating = request.headers.get("sec-fetch-mode") === "navigate";
  const back = (page: string, params: Record<string, string> = {}) => {
    const url = new URL(page, origin);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store" } });
  };

  const type = (request.headers.get("content-type") || "").toLowerCase();
  if (type.startsWith("multipart/")) {
    return navigating ? back("/not-sent.html", { reason: "invalid" }) : json({ ok: false, message: "Not sent: files cannot be sent with this form." }, 415, origin);
  }
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) {
    return navigating ? back("/not-sent.html", { reason: "invalid" }) : json({ ok: false, message: "Not sent: the form was too large." }, 413, origin);
  }
  const text = await request.text();
  const raw = Buffer.byteLength(text) > MAX_BODY_BYTES ? null : parseBody(text, type);
  if (!raw || Object.keys(raw).length > ENQUIRY_FIELDS.length + 10) {
    return navigating ? back("/not-sent.html", { reason: "invalid" }) : json({ ok: false, message: "Not sent: the form could not be read." }, 400, origin);
  }
  const picked: Record<string, unknown> = {};
  for (const key of [...ENQUIRY_FIELDS, SPAM_TRAP_FIELD]) if (key in raw) picked[key] = raw[key];

  try {
    const result = receiveWebsiteEnquiry({ raw: picked, address: clientAddress(request), origin });
    if (result.outcome === "stored") {
      return navigating ? back("/thank-you.html", { ref: result.reference }) : json({ ok: true, reference: result.reference }, 201, origin);
    }
    if (result.outcome === "spam") {
      // Typed into the box people never see: a program. It is answered as usual and nothing is kept.
      return navigating ? back("/thank-you.html") : json({ ok: true }, 201, origin);
    }
    if (result.outcome === "limited") {
      return navigating
        ? back("/not-sent.html", { reason: "limited" })
        : json({ ok: false, message: "Not sent: too many attempts from this connection. Please call us, or try again in an hour." }, 429, origin, { "Retry-After": "3600" });
    }
    return navigating ? back("/not-sent.html", { reason: "invalid" }) : json({ ok: false, message: "Not sent: please check the boxes marked.", errors: result.errors }, 400, origin);
  } catch {
    return navigating ? back("/not-sent.html", { reason: "error" }) : json({ ok: false, message: "Not sent: something went wrong at our end. Please call us." }, 500, origin);
  }
}
