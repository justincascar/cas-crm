"use client";

import Link from "next/link";
import { useState } from "react";
import { dueTextClass } from "@/lib/domain/due-wording";
import type { TodaysWorkRow } from "@/lib/domain/todays-work";

export function TodaysWork({ rows }: { rows: TodaysWorkRow[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <table className="ledger-table ledger-fit">
      <thead>
        <tr>
          <th>File</th>
          <th>Client</th>
          <th>Item</th>
          <th>When</th>
          <th>Handler</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const expanded = Boolean(open[row.claimId]);
          return (
            <ClaimRows
              key={row.claimId}
              row={row}
              expanded={expanded}
              onToggle={() => setOpen((current) => ({ ...current, [row.claimId]: !current[row.claimId] }))}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function ClaimRows({
  row,
  expanded,
  onToggle,
}: {
  row: TodaysWorkRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className={row.lead.tone === "overdue" ? "bg-[#f8ecec]" : row.lead.tone === "today" ? "bg-[#fff6e8]" : ""}>
        <td>
          <Link href={`/claims/${row.claimId}`} className="ref text-teal-dark hover:underline">
            {row.fileReference}
          </Link>
        </td>
        <td>{row.clientName}</td>
        <td>{row.lead.item}</td>
        <td className={dueTextClass(row.lead.tone)}>{row.lead.wording}</td>
        <td>{row.handlerName}</td>
        <td>
          {row.rest.length > 0 ? (
            <button type="button" className="text-sm text-teal-dark underline" aria-expanded={expanded} onClick={onToggle}>
              +{row.rest.length} more
            </button>
          ) : null}
        </td>
      </tr>
      {expanded
        ? row.rest.map((item) => (
            <tr key={item.id} className={item.tone === "overdue" ? "bg-[#f8ecec]" : item.tone === "today" ? "bg-[#fff6e8]" : ""}>
              <td></td>
              <td>{item.clientName}</td>
              <td>{item.item}</td>
              <td className={dueTextClass(item.tone)}>{item.wording}</td>
              <td>{item.handlerName}</td>
              <td></td>
            </tr>
          ))
        : null}
    </>
  );
}
