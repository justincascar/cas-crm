"use client";

import { useEffect, useState } from "react";
import { FUEL_OPTIONS, FUEL_OTHER, fuelChoice, fuelFromChoice } from "@/lib/domain/fuel";

/**
 * R51: the fuel drop-down. Default Not known. Other opens a short box to say what. The stored value travels in one
 * hidden field under the given name, so every form that saved a typed fuel saves this the same way.
 */
export function FuelSelect({
  name,
  value,
  defaultValue = "",
  onChange,
  className,
}: {
  name: string;
  /** Set when a lookup fills the fuel. */
  value?: string;
  defaultValue?: string;
  onChange?: (stored: string) => void;
  className: string;
}) {
  const start = fuelChoice(value ?? defaultValue);
  const [choice, setChoice] = useState(start.choice);
  const [other, setOther] = useState(start.other);
  useEffect(() => {
    if (value === undefined) return;
    const next = fuelChoice(value);
    setChoice(next.choice);
    setOther(next.other);
  }, [value]);
  const stored = fuelFromChoice(choice, other);
  return (
    <>
      <input type="hidden" name={name} value={stored} />
      <select
        aria-label="Fuel"
        className={className}
        value={choice}
        onChange={(event) => {
          setChoice(event.target.value);
          onChange?.(fuelFromChoice(event.target.value, other));
        }}
      >
        {FUEL_OPTIONS.map((option) => (
          <option key={option.label} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {choice === FUEL_OTHER ? (
        <input
          aria-label="Other fuel"
          className={className}
          value={other}
          maxLength={40}
          placeholder="Say what"
          onChange={(event) => {
            setOther(event.target.value);
            onChange?.(fuelFromChoice(choice, event.target.value));
          }}
        />
      ) : null}
    </>
  );
}
