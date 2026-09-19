import Link from "next/link";
import { notFound } from "next/navigation";
import { CommsDesk } from "@/components/claim-file/CommsDesk";
import { FileHistory } from "@/components/FileHistory";
import { HireVehiclePanel, ReserveHirePanel } from "@/components/claim-file/HireVehiclePanels";
import { ScreenForm } from "@/components/claim-file/ScreenForm";
import { PageHeader } from "@/components/ClaimTable";
import { CLAIM_SCREENS, getClaimScreen, screensByGroup } from "@/lib/claim-screens";
import { requireStaff } from "@/lib/auth/session";
import { getClaim, listFleet, listKnownAgents, listKnownInsurers, listReservations } from "@/lib/db/queries";
import { seedScreenDefaults } from "@/lib/db/screens";

export default async function ClaimWorkScreenPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; screen: string }>;
  searchParams: Promise<{ saved?: string; error?: string; field?: string; whatsapp?: string }>;
}) {
  const { id, screen } = await params;
  await requireStaff();
  const { saved, error, field, whatsapp } = await searchParams;
  const def = getClaimScreen(screen);
  if (!def) notFound();
  const data = getClaim(id);
  if (!data) notFound();
  const values = seedScreenDefaults(String(data.claim.id), screen);
  const actorId = String(data.claim.handler_id || "staff-sian");
  const justSaved = saved === "1";

  return (
    <div className="space-y-4">
      <PageHeader title={def.label} subtitle={def.hint} />
      {error ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p>
      ) : null}
      {whatsapp === "1" ? (
        <p className="rounded-md border border-ok/40 bg-[#eef6ef] px-4 py-3 text-sm text-ok">
          WhatsApp request recorded on this file. It was not sent to a live number.
        </p>
      ) : null}

      {screen === "comms" ? (
        <CommsDesk
          claimId={String(data.claim.id)}
          handlerId={actorId}
          defaults={{
            clientName: String(data.claim.client_name || ""),
            clientEmail: String(data.claim.email || ""),
            clientPhone: String(data.claim.mobile_tel || data.claim.telephone || ""),
            tpInsurer: String(data.thirdParties[0]?.insurer_name || ""),
            tpEmail: String(data.thirdParties[0]?.insurer_email || data.thirdParties[0]?.handler_email || ""),
            tpPhone: String(data.thirdParties[0]?.insurer_tel || data.thirdParties[0]?.handler_tel || ""),
            fileReference: String(data.claim.file_reference),
            policyRef: String(data.thirdParties[0]?.insurer_ref || data.thirdParties[0]?.policy_number || data.claim.own_policy_ref || ""),
          }}
          correspondence={data.correspondence.map((row) => ({ ...row }))}
          documents={data.documents.map((row) => ({ ...row }))}
          liabilityStatus={String(data.claim.claim_type || "")}
        />
      ) : null}

      {screen === "navigation" ? (
        <NavigationScreen claimId={String(data.claim.id)} />
      ) : null}

      {screen === "history" ? (
        <FileHistory
          claimId={String(data.claim.id)}
          handlerId={actorId}
          events={data.events}
          keyDates={data.keyDates}
          correspondence={data.correspondence}
          documents={data.documents}
          liabilityStatus={String(data.claim.claim_type || "")}
        />
      ) : null}

      {screen === "hire-vehicle" ? (
        <HireVehiclePanel
          claimId={String(data.claim.id)}
          actorId={actorId}
          fleet={listFleet()}
          values={values}
          saved={justSaved}
          error={error}
          errorField={field}
        />
      ) : null}

      {screen === "reserve" ? (
        <ReserveHirePanel
          claimId={String(data.claim.id)}
          actorId={actorId}
          fleet={listFleet()}
          reservations={listReservations()}
          error={error}
          errorField={field}
        />
      ) : null}

      {def.sections.length > 0 ? (
        <ScreenForm
          claimId={String(data.claim.id)}
          actorId={actorId}
          def={def}
          values={values}
          saved={justSaved}
          clientRole={String(data.claim.client_role || "")}
          insurers={listKnownInsurers()}
          agents={listKnownAgents()}
          error={error}
          errorField={field}
        />
      ) : null}
    </div>
  );
}

function NavigationScreen({ claimId }: { claimId: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 rounded-xl border border-line bg-card p-5">
      {screensByGroup().flatMap((group) =>
        group.screens
          .filter((s) => s.key !== "navigation")
          .map((screen) => (
            <div key={screen.key} className="flex items-center justify-between gap-2 border-b border-line py-2">
              <span className="text-sm">{screen.label}</span>
              <Link href={`/claims/${claimId}/work/${screen.key}`} className="text-xs font-semibold text-teal-dark">
                GO TO
              </Link>
            </div>
          )),
      )}
      <p className="sm:col-span-2 text-xs text-slate">{CLAIM_SCREENS.length} screens on this file, matching the current CRM viewing pane.</p>
    </div>
  );
}
