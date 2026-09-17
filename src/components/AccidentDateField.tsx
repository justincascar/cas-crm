"use client";

import { useState } from "react";
import { accidentDateError, londonTodayIso } from "@/lib/dates";

export function AccidentDateField({
  name,
  defaultValue = "",
  className = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm",
}: {
  name: string;
  defaultValue?: string;
  className?: string;
}) {
  const today = londonTodayIso();
  const [value, setValue] = useState(defaultValue.slice(0, 10));
  const error = accidentDateError(value);

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
      <p className="mt-1 text-xs text-slate">Cannot be after today (UK time).</p>
      {error ? <p className="mt-1 text-sm text-overdue">{error}</p> : null}
    </div>
  );
}
