"use client";

import { useState } from "react";

/** The rule stays word for word. It is hidden until this is opened. */
export function RuleHint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4">
      <button
        type="button"
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line bg-paper text-sm font-semibold text-navy"
        aria-expanded={open}
        aria-label={open ? "Hide the rule" : "Show the rule"}
        onClick={() => setOpen((value) => !value)}
      >
        ?
      </button>
      {open ? <p className="mt-2 text-sm text-slate">{text}</p> : null}
    </div>
  );
}
