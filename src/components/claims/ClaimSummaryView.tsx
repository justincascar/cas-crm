"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ClaimSummaryModel } from "@/lib/claims/claim-summary";

export function ClaimSummaryView({ model }: { model: ClaimSummaryModel }) {
  const summaryRef = useRef<HTMLElement>(null);
  const [pinned, setPinned] = useState(false);
  const [flagsOpen, setFlagsOpen] = useState(false);

  useEffect(() => {
    const summary = summaryRef.current;
    if (!summary || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      setPinned(entry ? !entry.isIntersecting : false);
    });
    observer.observe(summary);
    return () => observer.disconnect();
  }, []);

  const flagCount = model.flags.length;

  return (
    <>
      <section
        ref={summaryRef}
        id="claim-summary"
        data-claim-summary
        aria-label="Claim summary"
        className="rounded-xl border border-line bg-card px-4 py-3 shadow-sm"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-mono text-sm text-teal-dark">{model.reference}</p>
          <p className="text-sm text-slate">{model.handler}</p>
        </div>
        <p className="mt-1 text-sm">
          {model.client} · {model.registration}
        </p>
        <p className="text-sm text-slate">{model.insurerLine}</p>
        <p className="mt-2 text-sm">{model.statusLine}</p>
        <ol className="mt-3 flex flex-wrap gap-1 text-xs">
          {model.steps.map((step, index) => (
            <li key={step} className="flex items-center gap-1">
              {index > 0 ? <span className="text-slate">→</span> : null}
              <span className={step === model.stage ? "rounded bg-navy px-2 py-1 font-semibold text-white" : "rounded px-2 py-1 text-slate"}>{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm">{model.runningText}</p>
        {model.charges.length > 0 ? (
          <table className="ledger-table ledger-fit mt-3">
            <thead>
              <tr>
                <th>Head</th>
                <th>Claimed</th>
                <th>Agreed</th>
                <th>Received</th>
                <th>Outstanding</th>
                <th>Overpaid</th>
              </tr>
            </thead>
            <tbody>
              {model.charges.map((row) => (
                <tr key={row.head}>
                  <td>
                    {row.label}
                    {row.details.map((detail) => (
                      <span key={detail} className="mt-1 block text-xs font-normal text-slate">
                        {detail}
                      </span>
                    ))}
                  </td>
                  <td className="tabular">{row.claimed}</td>
                  <td className="tabular">{row.agreed}</td>
                  <td className="tabular">{row.received}</td>
                  <td className="tabular">
                    {row.outstanding}
                    {row.reviewNote ? <span className="mt-1 block text-xs font-normal text-slate">{row.reviewNote}</span> : null}
                  </td>
                  <td className="tabular">{row.overpaid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-3 text-sm text-slate">No money recorded on this file.</p>
        )}
        <p className="mt-3 text-sm">
          Next action: {model.nextAction}
          <span className={model.dueClass}> · {model.dueText}</span>
        </p>
        <div className="mt-2 text-sm">
          {flagCount === 0 ? (
            <p>No open flags</p>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-2">
                <span>
                  {flagCount} open {flagCount === 1 ? "flag" : "flags"}
                </span>
                <button
                  type="button"
                  className="rounded-md border border-line bg-white px-2 py-1 text-sm font-semibold text-navy"
                  aria-expanded={flagsOpen}
                  onClick={() => setFlagsOpen((open) => !open)}
                >
                  {flagsOpen ? "Hide" : "Show"}
                </button>
              </p>
              {flagsOpen ? (
                <ul className="mt-2 space-y-1">
                  {model.flags.map((flag) => (
                    <li key={flag.id} id={`flag-${flag.id}`}>
                      <Link href={flag.href} className="block text-teal-dark no-underline">
                        {flag.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>
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
          className="fixed top-0 right-0 left-0 z-40 flex h-10 max-h-10 items-center overflow-hidden border-b border-line bg-card px-4 text-left text-sm text-ink shadow-sm md:left-60"
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
