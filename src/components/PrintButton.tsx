"use client";

export function PrintButton() {
  return (
    <button className="rounded-md bg-navy px-4 py-2 text-sm text-white print:hidden" type="button" onClick={() => window.print()}>
      Print / save as PDF
    </button>
  );
}
