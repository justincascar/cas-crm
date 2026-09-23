"use client";

import { useEffect } from "react";

/** Opens the handler's own email client. It does not send the message. */
export function OpenPreparedMailto({ href, autoOpen }: { href: string; autoOpen: boolean }) {
  useEffect(() => {
    if (autoOpen) window.location.href = href;
  }, [autoOpen, href]);
  return (
    <a className="inline-block min-h-11 rounded-md border border-teal bg-white px-3 py-2 text-sm font-semibold text-teal-dark" href={href}>
      Open the pre-filled email
    </a>
  );
}
