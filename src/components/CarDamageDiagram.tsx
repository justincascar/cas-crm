"use client";

import { useState, type KeyboardEvent } from "react";
import { CAS_RED, DAMAGE_SHAPES as SHAPES } from "@/lib/domain/damage-drawing";
import { DAMAGE_ZONES, damageZoneLabels, parseDamageZones } from "@/lib/domain/file-setup";

/**
 * R52: a bird's-eye car (original drawing) that staff, or the client on their own form, tap to mark the damage.
 * The front is at the top, so the driver side (offside) is on the right and the passenger side (nearside) on the left.
 * A zone toggles on click only, never on touch or pointer down, so scrolling past the drawing cannot mark anything.
 * Each zone is a button for the keyboard. The choice is posted as zone keys, not as a picture.
 */

const EXTRA_BUTTONS = ["underside", "interior"];

function labelFor(key: string): string {
  return DAMAGE_ZONES.find((zone) => zone.key === key)?.label || key;
}

export function CarDamageDiagram({
  name,
  initial = "",
  onChange,
}: {
  /** The hidden field that carries the chosen zone keys, comma separated. */
  name: string;
  initial?: string;
  onChange?: (keys: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>(() => parseDamageZones(initial));
  const set = (next: string[]) => {
    const ordered = parseDamageZones(next.join(","));
    setPicked(ordered);
    onChange?.(ordered);
  };
  const toggle = (key: string) => set(picked.includes(key) ? picked.filter((item) => item !== key) : [...picked, key]);
  const keyed = (key: string) => (event: KeyboardEvent<SVGPathElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle(key);
    }
  };
  const all = picked.length === DAMAGE_ZONES.length;

  return (
    <div className="space-y-3" data-car-damage={picked.join(",")}>
      <input type="hidden" name={name} value={picked.join(",")} />
      <div className="mx-auto w-full max-w-[340px]">
        <div className="flex justify-between text-xs font-semibold text-navy">
          <span>Passenger side (nearside)</span>
          <span>Driver side (offside)</span>
        </div>
        <svg viewBox="0 0 320 560" className="mt-1 w-full touch-manipulation select-none" role="group" aria-label="Car seen from above. Front at the top. Choose the damaged areas.">
          <text x="160" y="548" textAnchor="middle" className="fill-slate text-[13px]">Rear</text>
          <text x="160" y="16" textAnchor="middle" className="fill-slate text-[11px]" dy="-2">Front</text>
          {SHAPES.map((shape) => {
            const on = picked.includes(shape.key);
            return (
              <path
                key={shape.key}
                d={shape.d}
                role="button"
                tabIndex={0}
                aria-pressed={on}
                aria-label={labelFor(shape.key)}
                data-zone={shape.key}
                onClick={() => toggle(shape.key)}
                onKeyDown={keyed(shape.key)}
                fill={on ? CAS_RED : "#f7f1e6"}
                stroke="#143044"
                strokeWidth={2}
                className="cursor-pointer outline-none focus-visible:stroke-[#1c6b66] focus-visible:stroke-[5]"
              >
                <title>{labelFor(shape.key)}</title>
              </path>
            );
          })}
        </svg>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {EXTRA_BUTTONS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={picked.includes(key)}
            data-zone={key}
            onClick={() => toggle(key)}
            className={`min-h-11 rounded-md border px-4 py-2 text-sm font-semibold ${picked.includes(key) ? "border-[#DC002B] bg-[#DC002B] text-white" : "border-line bg-white text-navy"}`}
          >
            {labelFor(key)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => set(all ? [] : DAMAGE_ZONES.map((zone) => zone.key))}
          className="min-h-11 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-navy"
        >
          {all ? "Clear all" : "All over"}
        </button>
      </div>
      {picked.length ? (
        <ul className="flex flex-wrap gap-2" aria-label="Damaged areas chosen">
          {damageZoneLabels(picked).map((label, index) => (
            <li key={picked[index]}>
              <button
                type="button"
                onClick={() => toggle(picked[index]!)}
                className="inline-flex min-h-9 items-center gap-1 rounded-full border border-[#DC002B] bg-[#fff0f2] px-3 py-1 text-sm text-[#9c0020]"
                aria-label={`Remove ${label}`}
                data-zone-chip={picked[index]}
              >
                {label} <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-center text-sm text-slate">No damaged areas marked yet.</p>
      )}
    </div>
  );
}
