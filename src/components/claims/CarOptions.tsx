import type { HireArea, HireCarChoice } from "@/lib/db/hire-choice";

export function carOption(car: HireCarChoice) {
  const missing = [!car.transmission ? "gearbox" : "", car.seats == null ? "seats" : "", !car.gtaGroup ? "group" : ""].filter(Boolean);
  return [
    car.label,
    car.transmission,
    car.seats != null ? `${car.seats} seats` : "",
    car.fuel,
    car.colour,
    car.gtaGroup ? `group ${car.gtaGroup}` : "",
    missing.length ? `details missing: ${missing.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** R36: the free cars, closest to the client's own first, then the cars with details missing, then other vehicles. */
export function CarOptionGroups({ area, exclude }: { area: HireArea; exclude?: string }) {
  const keep = (car: HireCarChoice) => car.id !== exclude;
  const groups: Array<[string, HireCarChoice[]]> = [
    ["Free and matching", area.cars.filter(keep)],
    ["Cars with details missing – check before offering", area.carsMissingDetails.filter(keep)],
    ["Other vehicles (vans, motorbikes, campervan, taxis)", area.otherVehicles.filter(keep)],
  ];
  return (
    <>
      {groups
        .filter(([, cars]) => cars.length)
        .map(([label, cars]) => (
          <optgroup key={label} label={label}>
            {cars.map((car) => (
              <option key={car.id} value={car.id}>
                {carOption(car)}
              </option>
            ))}
          </optgroup>
        ))}
    </>
  );
}

