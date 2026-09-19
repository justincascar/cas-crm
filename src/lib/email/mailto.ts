/** Build a mailto URL for the handler's own email client. This does not send mail. */
export function buildMailtoHref(to: string, subject: string, body: string): string {
  const address = to.trim();
  if (!address) throw new Error("An email address is required.");
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function parseMailtoHref(href: string): { to: string; subject: string; body: string } {
  const match = href.match(/^mailto:([^?]*)(?:\?(.*))?$/i);
  if (!match) return { to: "", subject: "", body: "" };
  const params = new URLSearchParams(match[2] || "");
  return {
    to: decodeURIComponent(match[1] || ""),
    subject: params.get("subject") || "",
    body: params.get("body") || "",
  };
}
