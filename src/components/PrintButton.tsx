"use client";

export function PrintButton({ label = "Print / save as PDF" }: { label?: string }) {
  return (
    <button className="rounded-md bg-navy px-4 py-2 text-sm text-white print:hidden" type="button" onClick={() => window.print()}>
      {label}
    </button>
  );
}
