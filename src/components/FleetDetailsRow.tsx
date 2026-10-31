"use client";

import { useState } from "react";
import { FUEL_OPTIONS, fuelChoice, fuelFromChoice, FUEL_OTHER } from "@/lib/domain/fuel";

const cell = "w-full min-w-0 rounded-md border border-line bg-white px-2 py-1.5 text-sm";

export type FleetRowCar = {
  fleetVehicleId: string;
  registration: string;
  makeModel: string;
  vehicleClass: string;
  transmission: string;
  fuel: string;
  seats: string;
  colour: string;
  gtaGroup: string;
  missing: string[];
};

export type FleetRowSuggestion = { value: string; source: string };
type Field = "vehicleClass" | "transmission" | "fuel" | "seats" | "colour" | "gtaGroup";

/**
 * R60: one car in the Complete fleet details table. Each change is saved at once (R54 style) and the row shows a tick
 * when the car has everything a hire needs. A suggestion is shown in grey with where it came from, and is saved only
 * when staff press Use.
 */
export function FleetDetailsRow({
  car,
  suggestions,
  groups,
  classes,
  backHref,
}: {
  car: FleetRowCar;
  suggestions: Partial<Record<Field, FleetRowSuggestion>>;
  groups: string[];
  classes: Array<{ value: string; label: string }>;
  backHref: string | null;
}) {
  const [values, setValues] = useState<Record<Field, string>>({
    vehicleClass: car.vehicleClass,
    transmission: car.transmission,
    fuel: car.fuel,
    seats: car.seats,
    colour: car.colour,
    gtaGroup: car.gtaGroup,
  });
  const [missing, setMissing] = useState<string[]>(car.missing);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [problem, setProblem] = useState("");
  const [other, setOther] = useState(fuelChoice(car.fuel).other);

  async function save(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setState("saving");
    setProblem("");
    try {
      const response = await fetch("/hire/fleet-details/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fleetVehicleId: car.fleetVehicleId, field, value }),
      });
      const body = (await response.json()) as { missing?: string[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Not saved.");
      setMissing(body.missing || []);
      setState("saved");
    } catch (error) {
      setState("failed");
      setProblem(error instanceof Error ? error.message : "Not saved – check your connection.");
    }
  }

  const hint = (field: Field) => {
    const suggestion = suggestions[field];
    if (!suggestion || values[field]) return null;
    return (
      <span className="mt-1 block text-xs text-slate" data-suggestion={field}>
        Suggested: {suggestion.value} ({suggestion.source}){" "}
        <button type="button" className="font-semibold text-teal-dark underline" onClick={() => void save(field, suggestion.value)}>
          Use
        </button>
      </span>
    );
  };
  const complete = missing.length === 0;
  const fuel = fuelChoice(values.fuel);

  return (
    <tr data-fleet-row={car.registration} data-complete={complete ? "yes" : "no"} className={complete ? "" : "bg-[#fff6e8]"}>
      <td className="whitespace-nowrap font-mono text-sm">
        {complete ? <span className="text-ok" aria-label="Complete">✓ </span> : null}
        {car.registration || "No registration"}
      </td>
      <td className="text-sm">{car.makeModel || "Make and model not on the V5C"}</td>
      <td>
        <select aria-label={`Type of ${car.registration}`} className={cell} value={values.vehicleClass} onChange={(e) => void save("vehicleClass", e.target.value)}>
          <option value="">Not known</option>
          {classes.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select aria-label={`Gearbox of ${car.registration}`} className={cell} value={values.transmission} onChange={(e) => void save("transmission", e.target.value)}>
          <option value="">Not known</option>
          <option value="Manual">Manual</option>
          <option value="Automatic">Automatic</option>
        </select>
        {hint("transmission")}
      </td>
      <td>
        <select
          aria-label={`Fuel of ${car.registration}`}
          className={cell}
          value={fuel.choice}
          onChange={(e) => (e.target.value === FUEL_OTHER ? setValues((current) => ({ ...current, fuel: "Other" })) : void save("fuel", e.target.value))}
        >
          {FUEL_OPTIONS.map((option) => (
            <option key={option.label} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {fuel.choice === FUEL_OTHER ? (
          <input
            aria-label={`Other fuel of ${car.registration}`}
            className={`${cell} mt-1`}
            value={other}
            placeholder="Say what"
            onChange={(e) => setOther(e.target.value)}
            onBlur={() => void save("fuel", fuelFromChoice(FUEL_OTHER, other))}
          />
        ) : null}
        {hint("fuel")}
      </td>
      <td>
        <select aria-label={`Seats in ${car.registration}`} className={cell} value={values.seats} onChange={(e) => void save("seats", e.target.value)}>
          <option value="">Not known</option>
          {Array.from({ length: 20 }, (_, index) => String(index + 1)).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        {hint("seats")}
      </td>
      <td>
        <input
          aria-label={`Colour of ${car.registration}`}
          className={cell}
          value={values.colour}
          onChange={(e) => setValues((current) => ({ ...current, colour: e.target.value }))}
          onBlur={(e) => void save("colour", e.target.value)}
        />
        {hint("colour")}
      </td>
      <td>
        <select aria-label={`GTA group of ${car.registration}`} className={cell} value={values.gtaGroup} onChange={(e) => void save("gtaGroup", e.target.value)}>
          <option value="">Not known</option>
          {groups.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        {hint("gtaGroup")}
      </td>
      <td className="text-xs" aria-live="polite">
        {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "failed" ? <span className="font-semibold text-overdue">Not saved: {problem}</span> : null}
        {!complete ? <span className="block text-slate">Missing: {missing.join(", ")}</span> : null}
        {complete && backHref ? (
          <a href={withCar(backHref, car.fleetVehicleId)} className="mt-1 block font-semibold text-teal-dark underline" data-back-with-car>
            Back to the hire with this car
          </a>
        ) : null}
      </td>
    </tr>
  );
}

/** The hire page again, with this car chosen in the list. */
function withCar(href: string, fleetVehicleId: string): string {
  const [path, hash = ""] = href.split("#");
  const join = path!.includes("?") ? "&" : "?";
  const isSwap = /[?&]swapCar=/.test(path!);
  const next = isSwap ? path!.replace(/([?&]swapCar=)[^&]*/, `$1${encodeURIComponent(fleetVehicleId)}`) : `${path}${join}car=${encodeURIComponent(fleetVehicleId)}`;
  return `${next}#${hash || (isSwap ? "swap-start" : "car")}`;
}
