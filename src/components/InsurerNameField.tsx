"use client";

import { useMemo, useState } from "react";
import { exactKnownInsurer, matchKnownInsurers, type KnownInsurer } from "@/lib/insurers";
import { toStartCase, toStartCaseLive } from "@/lib/text";

export function InsurerNameField({
  inputName,
  value,
  onChange,
  onPick,
  insurers,
  className,
}: {
  inputName: string;
  value: string;
  onChange: (value: string) => void;
  onPick: (insurer: KnownInsurer, mode: "replace" | "empty-only") => void;
  insurers: KnownInsurer[];
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => matchKnownInsurers(insurers, value), [insurers, value]);

  function pick(insurer: KnownInsurer) {
    onPick(insurer, "replace");
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        name={inputName}
        value={value}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open && matches.length > 0}
        className={className}
        onChange={(event) => {
          const next = toStartCaseLive(event.currentTarget.value);
          onChange(next);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          const formatted = toStartCase(value);
          if (formatted !== value) onChange(formatted);
          const exact = exactKnownInsurer(insurers, formatted);
          if (exact) onPick(exact, "empty-only");
          window.setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={(event) => {
          if (!open || matches.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((current) => (current + 1) % matches.length);
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((current) => (current - 1 + matches.length) % matches.length);
          }
          if (event.key === "Enter" && matches[active]) {
            event.preventDefault();
            pick(matches[active]);
          }
          if (event.key === "Escape") setOpen(false);
        }}
      />
      {open && matches.length > 0 ? (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-line bg-white text-sm shadow-sm">
          {matches.map((insurer, index) => (
            <li key={insurer.name}>
              <button
                type="button"
                className={`block w-full px-3 py-2 text-left ${index === active ? "bg-paper" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(insurer)}
              >
                <span className="block font-medium">{insurer.name}</span>
                <span className="block text-xs text-slate">
                  {[insurer.telephone, insurer.email].filter(Boolean).join(" · ") || "Saved name only — add telephone and email when you have them"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
