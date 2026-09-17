"use client";

import { useState } from "react";
import { ageInYearsOn, inspectDob, type DobKind } from "@/lib/age";
import { londonTodayIso } from "@/lib/dates";

const fieldClass = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export function AgeField({
  name,
  defaultValue = "",
  kind,
  confirmName,
  className = fieldClass,
}: {
  name: string;
  defaultValue?: string;
  kind: DobKind;
  confirmName?: string;
  className?: string;
}) {
  const today = londonTodayIso();
  const [value, setValue] = useState(defaultValue.slice(0, 10));
  const confirmField = confirmName || `${name}_confirmed`;
  const check = inspectDob(value, kind, today);
  const age = !("empty" in check) && check.age !== null ? check.age : value ? ageInYearsOn(value, today) : null;

  return (
    <div>
      <input
        name={name}
        type="date"
        value={value}
        max={today}
        onChange={(e) => setValue(e.target.value)}
        className={className}
      />
      <p className="mt-1 text-sm">
        Age: <strong>{age === null || Number.isNaN(age) ? "—" : age}</strong>
        <span className="text-xs text-slate"> (from today, UK time — confirm with the person)</span>
      </p>
      {"empty" in check || check.ok ? null : check.blocking ? (
        <p className="mt-1 text-sm text-overdue">{check.message}</p>
      ) : (
        <div className="mt-2 rounded-md border border-warn/40 bg-[#fff6e8] px-3 py-2 text-sm">
          {check.message}
          <label className="mt-2 flex items-start gap-2">
            <input type="checkbox" name={confirmField} value="yes" className="mt-1 h-4 w-4" />
            <span>I have double-checked this date of birth with them</span>
          </label>
        </div>
      )}
    </div>
  );
}
