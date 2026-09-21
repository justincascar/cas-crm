import { VEHICLE_CLASSES, VEHICLE_CLASS_LABELS } from "@/lib/fleet/classes";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export type FleetVehicleFormValues = {
  registration?: string | null;
  make?: string | null;
  model?: string | null;
  colour?: string | null;
  engine_cc?: string | number | null;
  fuel?: string | null;
  first_registered_on?: string | null;
  vehicle_class?: string | null;
  transmission?: string | null;
  seats?: string | number | null;
  location?: string | null;
  notes?: string | null;
};

export function FleetVehicleFields({
  values,
  registrationRequired,
}: {
  values?: FleetVehicleFormValues;
  registrationRequired?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">
        Registration
        <input
          name="registration"
          required={registrationRequired}
          className={field}
          defaultValue={String(values?.registration || "")}
          autoComplete="off"
        />
      </label>
      <label className="text-sm">
        Class
        <select name="vehicleClass" required className={field} defaultValue={String(values?.vehicle_class || "car")}>
          {VEHICLE_CLASSES.map((value) => (
            <option key={value} value={value}>
              {VEHICLE_CLASS_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Make
        <input name="make" className={field} defaultValue={String(values?.make || "")} />
      </label>
      <label className="text-sm">
        Model
        <input name="model" className={field} defaultValue={String(values?.model || "")} />
      </label>
      <label className="text-sm">
        Colour
        <input name="colour" className={field} defaultValue={String(values?.colour || "")} />
      </label>
      <label className="text-sm">
        Engine size (cc)
        <input name="engineCc" type="number" min={0} className={field} defaultValue={values?.engine_cc ? String(values.engine_cc) : ""} />
      </label>
      <label className="text-sm">
        Fuel
        <input name="fuel" className={field} defaultValue={String(values?.fuel || "")} placeholder="As on the V5C, e.g. heavy oil" />
      </label>
      <label className="text-sm">
        Date of first registration
        <input name="firstRegisteredOn" type="date" className={field} defaultValue={String(values?.first_registered_on || "")} />
      </label>
      <label className="text-sm">
        Gearbox
        <input name="transmission" className={field} defaultValue={String(values?.transmission || "")} placeholder="Not on a V5C — fill in if known" />
      </label>
      <label className="text-sm">
        Seating capacity
        <input name="seats" type="number" min={0} className={field} defaultValue={values?.seats ? String(values.seats) : ""} placeholder="Not on a V5C — fill in if known" />
      </label>
      <label className="text-sm sm:col-span-2">
        Location
        <input name="location" className={field} defaultValue={String(values?.location || "")} />
      </label>
      <label className="text-sm sm:col-span-2">
        Notes
        <textarea name="notes" rows={3} className={field} defaultValue={String(values?.notes || "")} />
      </label>
      <label className="text-sm sm:col-span-2">
        V5C PDF
        <input name="v5c" type="file" accept="application/pdf,.pdf" className={field} />
        <span className="mt-1 block text-xs text-slate">Optional when adding or replacing. The stored original is kept if you leave this empty.</span>
      </label>
    </div>
  );
}
