"use client";

import { useMemo, useState } from "react";
import { DAMAGE_PANELS } from "@/lib/claim-screens";

function parse(raw: string | undefined) {
  return new Set(
    (raw || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function Car({
  title,
  selected,
  onToggle,
}: {
  title: string;
  selected: Set<string>;
  onToggle: (key: string) => void;
}) {
  const box = (key: string) => (
    <label key={key} className="flex h-6 w-6 items-center justify-center rounded border border-navy/40 bg-white">
      <input
        type="checkbox"
        className="h-3.5 w-3.5"
        checked={selected.has(key)}
        onChange={() => onToggle(key)}
        aria-label={DAMAGE_PANELS.find((p) => p.key === key)?.label || key}
      />
    </label>
  );

  return (
    <div className="min-w-[220px] text-center">
      <p className="text-xs uppercase tracking-[0.14em] text-slate">Offside</p>
      <div className="mt-1 grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <div />
        <div className="flex justify-center gap-6">
          {box("offside_front")}
          {box("offside")}
          {box("offside_rear")}
        </div>
        <div />
        {box("front")}
        <div className="relative mx-auto h-28 w-36 rounded-[40%] border-2 border-navy bg-[#f7f1e6]">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-navy">F</span>
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-navy">B</span>
          <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-teal-dark">
            {title}
          </span>
        </div>
        {box("rear")}
        <div />
        <div className="flex justify-center gap-6">
          {box("nearside_front")}
          {box("nearside")}
          {box("nearside_rear")}
        </div>
        <div />
      </div>
      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate">Nearside</p>
    </div>
  );
}

export function DamageDiagram({
  clientPanels,
  tpPanels,
}: {
  clientPanels?: string;
  tpPanels?: string;
}) {
  const [client, setClient] = useState(() => parse(clientPanels));
  const [tp, setTp] = useState(() => parse(tpPanels));
  const clientValue = useMemo(() => [...client].join(","), [client]);
  const tpValue = useMemo(() => [...tp].join(","), [tp]);

  const toggle = (set: typeof setClient) => (key: string) => {
    set((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-3 rounded-xl border border-line bg-card p-5">
      <p className="text-sm text-slate">Tick damaged panels. This is a staff record, not a roadworthiness certificate.</p>
      <div className="flex flex-wrap justify-center gap-10">
        <Car title="Client" selected={client} onToggle={toggle(setClient)} />
        <Car title="Third party" selected={tp} onToggle={toggle(setTp)} />
      </div>
      <input type="hidden" name="clientPanels" value={clientValue} />
      <input type="hidden" name="tpPanels" value={tpValue} />
    </div>
  );
}
