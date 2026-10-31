import { FuelSelect } from "@/components/FuelSelect";
import { FLEET_DETAIL_LABELS, GEARBOXES, type FleetCarDetails, type FleetDetailField } from "@/lib/db/fleet-details";

/**
 * One box for a detail missing on a fleet record. Gearbox, seats and GTA group start empty: they are never guessed.
 * The GTA group starts on the Settings rule's group only where Settings has a clear rule for the make and model.
 */
export function FleetDetailBox({
  field,
  car,
  groups,
  className,
}: {
  field: FleetDetailField;
  car: FleetCarDetails;
  groups: string[];
  className: string;
}) {
  let input;
  if (field === "transmission") {
    input = (
      <select name="transmission" className={className} defaultValue="">
        <option value="">Choose</option>
        {GEARBOXES.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    );
  } else if (field === "gtaGroup") {
    input = (
      <select name="gtaGroup" className={className} defaultValue={car.suggestedGroup?.group || ""}>
        <option value="">Choose a group</option>
        {groups.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
    );
  } else if (field === "fuel") {
    input = <FuelSelect name="fuel" className={className} />;
  } else if (field === "seats" || field === "mileage") {
    input = <input name={field} inputMode="numeric" className={className} />;
  } else {
    input = <input name={field} className={className} />;
  }
  return (
    <label data-car-detail-box={field}>
      {FLEET_DETAIL_LABELS[field]}
      {input}
      {field === "gtaGroup" ? (
        <span className="mt-1 block text-slate" data-gta-suggestion>
          {car.suggestedGroup
            ? `Suggested by the Settings rule ${car.suggestedGroup.rule}. Check it before saving.`
            : "No Settings rule covers this make and model. Choose the group."}
        </span>
      ) : null}
    </label>
  );
}
