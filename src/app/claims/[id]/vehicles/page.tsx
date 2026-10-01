import Link from "next/link";
import { notFound } from "next/navigation";
import { ClaimAudatexFields } from "@/components/ClaimAudatexFields";
import { PageHeader } from "@/components/ClaimTable";
import { requireStaff } from "@/lib/auth/session";
import { getClaim, suggestAudatexCodesForClaim } from "@/lib/db/queries";
import {
  CLIENT_VEHICLE_EMPTY,
  THIRD_PARTY_VEHICLE_EMPTY,
  thirdPartyVehicleCards,
  vehicleIsRecorded,
  vehicleSpecLines,
  vehicleSummary,
  type VehicleSpecLine,
} from "@/lib/domain/vehicle-display";

function SpecList({ lines }: { lines: VehicleSpecLine[] }) {
  if (lines.length === 0) return null;
  return (
    <dl className="mt-3 space-y-1 text-sm">
      {lines.map((line) => (
        <div key={line.label} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2">
          <dt className="text-slate">{line.label}</dt>
          <dd>{line.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function ClaimVehiclesPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  const data = getClaim(id);
  if (!data) notFound();
  const claim = data.claim;
  const clientFields = {
    registration: claim.registration,
    make: claim.make,
    model: claim.model,
  };
  const clientRecorded = vehicleIsRecorded(clientFields);
  const clientSummary = vehicleSummary(clientFields);
  const clientLines = clientRecorded
    ? vehicleSpecLines({
        colour: claim.colour,
        transmission: claim.transmission,
        fuel: claim.fuel,
        bodyType: claim.body_type,
        seats: claim.seats,
        engineCc: claim.engine_cc,
        vehicleClass: claim.vehicle_class,
        gtaGroup: claim.gta_group,
        taxStatus: claim.tax_status,
        motStatus: claim.mot_status,
        insuranceRecorded: claim.insurance_recorded,
      })
    : [];
  const thirdParties = thirdPartyVehicleCards(data.thirdParties);
  const audatexSuggestion = suggestAudatexCodesForClaim(String(claim.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vehicles"
        subtitle="The client's own vehicle and any third-party vehicle already stored on this file. Details are edited on the existing vehicle screens."
      />
      <div className="grid items-start gap-6 md:grid-cols-2">
        <section className="space-y-4">
          <div className="rounded-xl border border-line bg-card p-5">
            <h2 className="font-serif text-xl text-navy-deep">Client&apos;s own vehicle</h2>
            {clientRecorded ? (
              <>
                <p className="mt-2 text-sm font-semibold text-navy">{clientSummary}</p>
                <SpecList lines={clientLines} />
                {Number(claim.lookup_incomplete) === 1 ? (
                  <p className="mt-3 text-xs text-slate">Lookup was incomplete. Missing fields have not been guessed.</p>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-sm">{CLIENT_VEHICLE_EMPTY}</p>
            )}
            <p className="mt-3 text-sm">
              <Link className="text-teal-dark underline" href={`/claims/${claim.id}/work/vehicle`}>
                {clientRecorded ? "Edit on the vehicle screen" : "Add it on the vehicle screen"}
              </Link>
            </p>
          </div>
          <ClaimAudatexFields
            claimId={String(claim.id)}
            insurerName={audatexSuggestion.insurerName}
            networkCode={String(claim.audatex_network_code || "")}
            workProviderCode={String(claim.audatex_work_provider_code || "")}
            suggestedNetwork={audatexSuggestion.network}
            suggestedWorkProvider={audatexSuggestion.workProvider}
          />
        </section>
        <section className="space-y-4">
          {thirdParties.map((party) => (
            <div key={party.id} className="rounded-xl border border-line bg-card p-5">
              <h2 className="font-serif text-xl text-navy-deep">{party.title}</h2>
              {party.recorded ? (
                <>
                  <p className="mt-2 text-sm font-semibold text-navy">{party.summary}</p>
                  <SpecList lines={party.lines} />
                </>
              ) : (
                <p className="mt-2 text-sm">{THIRD_PARTY_VEHICLE_EMPTY}</p>
              )}
              {party.editScreen ? (
                <p className="mt-3 text-sm">
                  <Link className="text-teal-dark underline" href={`/claims/${claim.id}/work/${party.editScreen}`}>
                    {party.recorded ? "Edit on the third-party screen" : "Add it on the third-party screen"}
                  </Link>
                </p>
              ) : null}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
