export const VEHICLE_CLASSES = [
  "car",
  "van",
  "motorcycle",
  "campervan",
  "wheelchair_accessible_taxi",
] as const;

export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export const VEHICLE_CLASS_LABELS: Record<VehicleClass, string> = {
  car: "Car",
  van: "Van",
  motorcycle: "Motorcycle",
  campervan: "Campervan",
  wheelchair_accessible_taxi: "Wheelchair-accessible taxi",
};

export function isVehicleClass(value: string): value is VehicleClass {
  return (VEHICLE_CLASSES as readonly string[]).includes(value);
}

export function vehicleClassLabel(value: string | null | undefined): string {
  if (value && isVehicleClass(value)) return VEHICLE_CLASS_LABELS[value];
  return value ? value.replaceAll("_", " ") : "";
}
