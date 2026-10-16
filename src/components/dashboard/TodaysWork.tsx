"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RecordRepairSteps } from "@/components/claims/RecordRepairSteps";
import { SendPreparedEmailForm } from "@/components/claims/SendPreparedEmailForm";
import { SubmitKeyInput } from "@/components/SubmitKeyInput";
import { CALL_OUTCOMES } from "@/lib/domain/desk-actions";
import { BANK_DETAILS_MISSING_SETTINGS } from "@/lib/domain/payment-details";
import { dueRowClass, dueTextClass } from "@/lib/domain/due-wording";
import { tierLabel, type DeskWorkItem, type TodaysWorkRow } from "@/lib/domain/todays-work";
import { formatGbp } from "@/lib/money";

export type PreparedDeskEmail = {
  itemId: string;
  claimId: string;
  correspondenceId: string;
  subject: string;
  to: string;
  body: string;
};

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export function TodaysWork({
  rows,
  bankDetailsMissing,
  liveSending,
  undoId,
  prepared,
}: {
  rows: TodaysWorkRow[];
  bankDetailsMissing: boolean;
  liveSending: boolean;
  undoId: string | null;
  prepared: PreparedDeskEmail | null;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [action, setAction] = useState<Record<string, string>>({});
  const [showUndo, setShowUndo] = useState(Boolean(undoId));
  useEffect(() => {
    if (!undoId) return;
    const timer = window.setTimeout(() => setShowUndo(false), 10_000);
    return () => window.clearTimeout(timer);
  }, [undoId]);

  return (
    <div>
      {showUndo && undoId ? (
        <form method="post" action="/dashboard/work" className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-line bg-[#eceae4] px-4 py-3 text-sm">
          <SubmitKeyInput />
          <input type="hidden" name="intent" value="undo" />
          <input type="hidden" name="waitId" value={undoId} />
          <span>Waiting. You can undo this for a few seconds.</span>
          <button type="submit" className="min-h-11 rounded-md border border-navy px-3 py-2 font-semibold text-navy">
            Undo
          </button>
        </form>
      ) : null}
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
                action={action}
                setAction={setAction}
                onToggle={() => setOpen((current) => ({ ...current, [row.claimId]: !current[row.claimId] }))}
                bankDetailsMissing={bankDetailsMissing}
                liveSending={liveSending}
                prepared={prepared}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ClaimRows({
  row,
  expanded,
  action,
  setAction,
  onToggle,
  bankDetailsMissing,
  liveSending,
  prepared,
}: {
  row: TodaysWorkRow;
  expanded: boolean;
  action: Record<string, string>;
  setAction: (next: Record<string, string>) => void;
  onToggle: () => void;
  bankDetailsMissing: boolean;
  liveSending: boolean;
  prepared: PreparedDeskEmail | null;
}) {
  const items = [row.lead, ...(expanded ? row.rest : [])];
  return (
    <>
      {items.map((item, index) => (
        <ItemRows
          key={item.id}
          item={item}
          lead={index === 0}
          more={index === 0 ? row.rest.length : 0}
          expanded={expanded}
          onToggle={onToggle}
          openAction={action[item.id] || ""}
          onAction={(name) => setAction({ ...action, [item.id]: action[item.id] === name ? "" : name })}
          bankDetailsMissing={bankDetailsMissing}
          liveSending={liveSending}
          prepared={prepared?.itemId === item.id ? prepared : null}
          showRunning={index === 0 && row.lead.tier === 2}
        />
      ))}
    </>
  );
}

function ItemRows({
  item,
  lead,
  more,
  expanded,
  onToggle,
  openAction,
  onAction,
  bankDetailsMissing,
  liveSending,
  prepared,
  showRunning,
}: {
  item: DeskWorkItem;
  lead: boolean;
  more: number;
  expanded: boolean;
  onToggle: () => void;
  openAction: string;
  onAction: (name: string) => void;
  bankDetailsMissing: boolean;
  liveSending: boolean;
  prepared: PreparedDeskEmail | null;
  showRunning: boolean;
}) {
  return (
    <>
      <tr className={dueRowClass(item.tone)}>
        <td>
          {lead ? (
            <Link href={`/claims/${item.claimId}`} className="ref text-teal-dark hover:underline">
              {item.fileReference}
            </Link>
          ) : null}
        </td>
        <td>{lead ? item.clientName : ""}</td>
        <td>
          <span className="mr-2 rounded border border-line px-1.5 py-0.5 text-xs text-slate">{tierLabel(item.tier)}</span>
          {item.item}
          {showRunning ? (
            <span className="mt-1 block text-sm font-semibold text-navy-deep">{formatGbp(item.runningDailyPence || 0)}/day running</span>
          ) : null}
        </td>
        <td className={dueTextClass(item.tone)}>{item.wording}</td>
        <td>{item.handlerName}</td>
        <td>
          {more > 0 ? (
            <button type="button" className="text-sm text-teal-dark underline" aria-expanded={expanded} onClick={onToggle}>
              +{more} more
            </button>
          ) : null}
        </td>
      </tr>
      <tr>
        <td colSpan={6} className="bg-paper">
          <div className="flex flex-wrap gap-2 py-2">
            <button type="button" className="min-h-11 rounded-md border border-line bg-card px-3 text-sm font-semibold" onClick={() => onAction("call")}>
              Log call
            </button>
            {item.prepareChase ? (
              <button type="button" className="min-h-11 rounded-md border border-line bg-card px-3 text-sm font-semibold" onClick={() => onAction("prepare")}>
                Prepare chaser
              </button>
            ) : null}
            <button type="button" className="min-h-11 rounded-md border border-line bg-card px-3 text-sm font-semibold" onClick={() => onAction("step")}>
              Record step
            </button>
            <button type="button" className="min-h-11 rounded-md border border-line bg-card px-3 text-sm font-semibold" onClick={() => onAction("wait")}>
              Wait until
            </button>
            <Link href={`/claims/${item.claimId}`} className="inline-flex min-h-11 items-center rounded-md bg-navy px-3 text-sm font-semibold text-white">
              Open claim
            </Link>
          </div>
          {openAction === "call" ? <CallForm item={item} /> : null}
          {openAction === "wait" ? <WaitForm item={item} /> : null}
          {openAction === "prepare" ? (
            <PreparePanel item={item} bankDetailsMissing={bankDetailsMissing} liveSending={liveSending} prepared={prepared} />
          ) : null}
          {openAction === "step" ? (
            <div className="grid gap-4 py-3 lg:grid-cols-2">
              <RecordRepairSteps claimId={item.claimId} mode="inspection" returnTo="/" />
              <RecordRepairSteps claimId={item.claimId} mode="workshop" returnTo="/" />
            </div>
          ) : null}
        </td>
      </tr>
    </>
  );
}

function CallForm({ item }: { item: DeskWorkItem }) {
  return (
    <form method="post" action="/dashboard/work" className="max-w-xl space-y-2 py-3">
      <SubmitKeyInput />
      <input type="hidden" name="intent" value="call" />
      <input type="hidden" name="claimId" value={item.claimId} />
      <input type="hidden" name="itemKey" value={item.id} />
      <input type="hidden" name="chaseKind" value={item.chaseKind || ""} />
      <input type="hidden" name="recordVersion" value={item.waitVersion} />
      <label className="block text-sm">
        What happened
        <select name="outcome" required className={field} defaultValue="spoke">
          {CALL_OUTCOMES.map((outcome) => (
            <option key={outcome.value} value={outcome.value}>
              {outcome.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Promised by (only if they promised a date)
        <input name="promiseOn" type="date" className={field} />
      </label>
      <label className="block text-sm">
        Note
        <textarea name="note" rows={2} className={field} />
      </label>
      <button type="submit" className="min-h-11 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
        Save call
      </button>
    </form>
  );
}

function WaitForm({ item }: { item: DeskWorkItem }) {
  return (
    <form method="post" action="/dashboard/work" className="max-w-xl space-y-2 py-3">
      <SubmitKeyInput />
      <input type="hidden" name="intent" value="wait" />
      <input type="hidden" name="claimId" value={item.claimId} />
      <input type="hidden" name="itemKey" value={item.id} />
      <input type="hidden" name="chaseKind" value={item.chaseKind || ""} />
      <input type="hidden" name="recordVersion" value={item.waitVersion} />
      <p className="text-sm text-slate">The item leaves this list and comes back on that date. 14 days is the usual maximum.</p>
      <label className="block text-sm">
        Wait until
        <input name="waitUntil" type="date" required className={field} />
      </label>
      <label className="block text-sm">
        Reason
        <input name="reason" required className={field} />
      </label>
      <button type="submit" className="min-h-11 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
        Wait
      </button>
    </form>
  );
}

function PreparePanel({
  item,
  bankDetailsMissing,
  liveSending,
  prepared,
}: {
  item: DeskWorkItem;
  bankDetailsMissing: boolean;
  liveSending: boolean;
  prepared: PreparedDeskEmail | null;
}) {
  return (
    <div className="max-w-2xl space-y-3 py-3">
      {bankDetailsMissing ? <p className="text-sm font-semibold">{BANK_DETAILS_MISSING_SETTINGS}</p> : null}
      <form method="post" action="/dashboard/work">
        <SubmitKeyInput />
        <input type="hidden" name="intent" value="prepare" />
        <input type="hidden" name="claimId" value={item.claimId} />
        <input type="hidden" name="itemKey" value={item.id} />
        <input type="hidden" name="chaseKind" value={item.chaseKind || ""} />
        <button type="submit" className="min-h-11 rounded-md bg-teal px-3 py-2 text-sm font-semibold text-white">
          Open the prepared email
        </button>
      </form>
      {prepared ? (
        <div className="rounded-md border border-line bg-card p-4 text-sm">
          <p className="font-semibold">{prepared.subject || "Prepared email"}</p>
          <p className="text-slate">To {prepared.to || "No address on the file"}</p>
          <pre className="mt-2 whitespace-pre-wrap font-sans">{prepared.body}</pre>
          {bankDetailsMissing ? null : (
            <div className="mt-3">
              <SendPreparedEmailForm
                claimId={prepared.claimId}
                correspondenceId={prepared.correspondenceId}
                returnTo="/"
                liveSending={liveSending}
              />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
