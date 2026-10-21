"use client";

import { useEffect, useRef, useState } from "react";
import type { ClaimSummaryModel } from "@/lib/claims/claim-summary";

export function ClaimSummaryView({ model }: { model: ClaimSummaryModel }) {
  const summaryRef = useRef<HTMLElement>(null);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const summary = summaryRef.current;
    if (!summary || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      setPinned(entry ? !entry.isIntersecting : false);
    });
    observer.observe(summary);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <section
        ref={summaryRef}
        id="claim-summary"
        data-claim-summary
        aria-label="Claim summary"
        className="rounded-xl border border-line bg-card px-4 py-3 shadow-sm print:hidden"
      >
        <p className="text-sm">
          <span className="font-mono text-teal-dark">{model.reference}</span>
          {" · "}
          {model.client}
          {" · "}
          {model.registration}
          {" · "}
          {model.insurerLine}
          {" · "}
          {model.handler}
        </p>
        <p className="mt-1 text-sm">
          {model.statusLine}
          {" · "}
          {model.runningText}
          {" · Outstanding "}
          {model.outstandingTotal}
        </p>
        <p className="mt-1 text-sm">{model.stageLine}</p>
        <p className="mt-1 text-sm">
          Next action: {model.nextAction}
          <span className={model.dueClass}> · {model.dueText}</span>
        </p>
        {model.staffNote ? (
          <p className="mt-1 text-sm" data-staff-note>
            Note: {model.staffNote}
            {model.staffNoteBy && model.staffNoteOn ? ` – added by ${model.staffNoteBy}, ${model.staffNoteOn}` : ""}
          </p>
        ) : null}
        {model.conflict ? (
          <p id="fleet-conflict" className="mt-2 text-sm font-semibold text-overdue">
            {model.conflict}
          </p>
        ) : null}
      </section>
      {pinned ? (
        <button
          type="button"
          data-claim-slim-bar
          className="fixed top-0 right-0 left-0 z-40 flex h-10 max-h-10 items-center overflow-hidden border-b border-line bg-card px-4 text-left text-sm text-ink shadow-sm print:hidden md:left-60"
          onClick={() => summaryRef.current?.scrollIntoView({ block: "start" })}
        >
          <span className="block min-w-0 truncate">
            <span data-slim="reference">{model.reference}</span>
            {" · "}
            <span data-slim="client">{model.client}</span>
            {" · "}
            <span data-slim="registration">{model.registration}</span>
            {" · "}
            <span data-slim="running">{model.runningDaily}</span>
            {" · Outstanding "}
            <span data-slim="outstanding">{model.outstandingTotal}</span>
            {" · "}
            <span data-slim="next">{model.nextAction}</span>
            {" · "}
            <span data-slim="due">{model.dueText}</span>
          </span>
        </button>
      ) : null}
    </>
  );
}
