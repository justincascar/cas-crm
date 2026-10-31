import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ClaimTable";
import { FleetDetailsRow, type FleetRowSuggestion } from "@/components/FleetDetailsRow";
import { isOfficeRole } from "@/lib/auth/roles";
import { requireSignedIn } from "@/lib/auth/session";
import { all } from "@/lib/db/connection";
import {
  allFleetCarDetails,
  FLEET_DETAIL_LABELS,
  fleetGroupChoices,
  hireDetailsMissing,
  suggestGearbox,
  v5cSuggestions,
} from "@/lib/db/fleet-details";
import { VEHICLE_CLASSES, VEHICLE_CLASS_LABELS } from "@/lib/fleet/classes";

/** Only a path back into a claim's hire, never somewhere else. */
function safeBack(raw: string | undefined): string | null {
  const value = String(raw || "");
  return /^\/claims\/[A-Za-z0-9_-]+\/hire(?:[?#][\w=&%#.-]*)?$/.test(value) ? value : null;
}

/**
 * R60: every fleet car on one page, so the details a hire needs are entered once, here, and are simply there on
 * every hire. Each row saves as it changes. Suggestions (from the model name, the V5C and the Settings group rules)
 * are shown in grey and saved only when staff press Use.
 */
export default async function FleetDetailsPage({ searchParams }: { searchParams: Promise<{ missing?: string; car?: string; back?: string }> }) {
  const staff = await requireSignedIn();
  if (!isOfficeRole(staff.role)) redirect("/jobs?notice=office");
  const { missing, car: focusCar, back } = await searchParams;
  const onlyMissing = missing === "1";
  const backHref = safeBack(back);
  const real = new Set(all<{ id: string }>(`SELECT id FROM fleet_vehicles WHERE is_real = 1 AND removed_at IS NULL`).map((row) => String(row.id)));
  const cars = [...allFleetCarDetails().values()]
    .filter((car) => !onlyMissing || hireDetailsMissing(car).length > 0 || car.fleetVehicleId === focusCar)
    .sort((a, b) => Number(real.has(b.fleetVehicleId)) - Number(real.has(a.fleetVehicleId)) || a.registration.localeCompare(b.registration, "en-GB", { numeric: true }));
  const groups = fleetGroupChoices();
  const classes = VEHICLE_CLASSES.map((value) => ({ value, label: VEHICLE_CLASS_LABELS[value] }));
  const incomplete = [...allFleetCarDetails().values()].filter((car) => hireDetailsMissing(car).length > 0).length;
  const query = (next: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ missing: onlyMissing ? "1" : undefined, back: backHref || undefined, ...next })) if (value) params.set(key, value);
    const text = params.toString();
    return text ? `/hire/fleet-details?${text}` : "/hire/fleet-details";
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Complete fleet details"
        subtitle="Gearbox, fuel, seats, colour and GTA group are entered once here and are on every hire of the car. A hire cannot choose a car until they are. Each change saves at once and goes in the car's history."
        actions={
          <Link href="/hire" className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-navy">
            Back to Hire / Fleet
          </Link>
        }
      />
      {backHref ? (
        <p className="rounded-md border border-teal/40 bg-[#eef8f6] px-4 py-3 text-sm">
          Completing a car for a hire. When its row has a tick, use <strong>Back to the hire with this car</strong> in that row, or{" "}
          <Link href={backHref} className="font-semibold text-teal-dark underline">
            go back without choosing
          </Link>
          .
        </p>
      ) : null}
      <p className="text-sm" data-incomplete-count={incomplete}>
        {incomplete ? `${incomplete} ${incomplete === 1 ? "car has" : "cars have"} details missing.` : "Every car has the details a hire needs."}{" "}
        {onlyMissing ? (
          <Link href={query({ missing: undefined })} className="text-teal-dark underline">
            Show every car
          </Link>
        ) : (
          <Link href={query({ missing: "1" })} className="text-teal-dark underline">
            Only cars with details missing
          </Link>
        )}
      </p>
      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="ledger-table min-w-[1100px]">
          <thead>
            <tr>
              <th>Registration</th>
              <th>Make and model</th>
              <th>Type</th>
              <th>{FLEET_DETAIL_LABELS.transmission}</th>
              <th>{FLEET_DETAIL_LABELS.fuel}</th>
              <th>{FLEET_DETAIL_LABELS.seats}</th>
              <th>{FLEET_DETAIL_LABELS.colour}</th>
              <th>{FLEET_DETAIL_LABELS.gtaGroup}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cars.map((car) => {
              const suggestions: Record<string, FleetRowSuggestion> = {};
              const gear = car.transmission ? null : suggestGearbox(car.model);
              if (gear) suggestions.transmission = gear;
              const v5c = car.fuel && car.colour ? {} : v5cSuggestions(car.registration);
              if (!car.fuel && v5c.fuel) suggestions.fuel = { value: v5c.fuel, source: "read from the V5C" };
              if (!car.colour && v5c.colour) suggestions.colour = { value: v5c.colour, source: "read from the V5C" };
              if (!car.gtaGroup && car.suggestedGroup) suggestions.gtaGroup = { value: car.suggestedGroup.group, source: `Settings rule ${car.suggestedGroup.rule}` };
              return (
                <FleetDetailsRow
                  key={car.fleetVehicleId}
                  car={{
                    fleetVehicleId: car.fleetVehicleId,
                    registration: car.registration,
                    makeModel: [car.make, car.model].filter(Boolean).join(" "),
                    vehicleClass: car.vehicleClass,
                    transmission: car.transmission,
                    fuel: car.fuel,
                    seats: car.seats != null ? String(car.seats) : "",
                    colour: car.colour,
                    gtaGroup: car.gtaGroup || "",
                    missing: hireDetailsMissing(car).map((field) => (field === "gtaGroup" ? "GTA group" : FLEET_DETAIL_LABELS[field].toLowerCase())),
                  }}
                  suggestions={suggestions}
                  groups={groups}
                  classes={classes}
                  backHref={backHref}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate">
        Seats were not read from the V5Cs, so they are never suggested. A gearbox is suggested only where the model name says AUTO, S-A, CVT or
        DSG, or ends in A. A GTA group is suggested only where the Settings rules for the make and model agree. An agreement already produced keeps
        what it was produced with.
      </p>
    </div>
  );
}
