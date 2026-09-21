import Link from "next/link";
import { actionCreateFleetVehicle } from "@/app/fleet-actions";
import { PageHeader } from "@/components/ClaimTable";
import { FleetVehicleFields } from "@/components/FleetVehicleFields";
import { ValidatedForm } from "@/components/ValidatedForm";
import { requireStaff } from "@/lib/auth/session";
import { DEFAULT_VEHICLE_LOCATION } from "@/lib/constants";

export default async function NewFleetVehiclePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireStaff();
  const { error } = await searchParams;
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Add fleet vehicle"
        subtitle="Adds a real (production) fleet vehicle. Gearbox and seating are not on a V5C — leave them blank unless you know them."
        actions={
          <Link href="/hire" className="text-sm text-teal-dark underline">
            Back to fleet
          </Link>
        }
      />
      {error ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p>
      ) : null}
      <section className="rounded-xl border border-line bg-card p-5">
        <ValidatedForm action={actionCreateFleetVehicle} encType="multipart/form-data" className="space-y-4">
          <FleetVehicleFields registrationRequired values={{ location: DEFAULT_VEHICLE_LOCATION }} />
          <button type="submit" className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white">
            Add vehicle
          </button>
        </ValidatedForm>
      </section>
    </div>
  );
}
