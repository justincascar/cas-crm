import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CommsDesk } from "@/components/claim-file/CommsDesk";
import { FileHistory } from "@/components/FileHistory";
import { HireVehiclePanel, ReserveHirePanel } from "@/components/claim-file/HireVehiclePanels";
import { ScreenForm } from "@/components/claim-file/ScreenForm";
import { PageHeader } from "@/components/ClaimTable";
import { CLAIM_SCREENS, getClaimScreen, screensByGroup } from "@/lib/claim-screens";
import { workScreenTabPath } from "@/lib/domain/claim-tabs";
import { headScreenPath } from "@/lib/domain/head-screen";
import { requireStaff } from "@/lib/auth/session";
import { getClaim, listFleet, listKnownAgents, listKnownInsurers, listReservations } from "@/lib/db/queries";
import { findPreparedEngineerInstruction, getEngineer, listActiveEngineers } from "@/lib/db/engineers";
import { representativeIsRecorded, savedText } from "@/lib/email/send-to";
import { findPreparedChase, listChasesForClaim } from "@/lib/db/chase";
import { isChaseKind } from "@/lib/domain/chase";
import { listHireAgreements } from "@/lib/db/chronology";
import { impecuniosityGate } from "@/lib/db/impecuniosity";
import { getScreenData, seedScreenDefaults } from "@/lib/db/screens";
import { loadClash, screenVersion, sectionVersion } from "@/lib/db/record-version";
import { sharedVersionFields, SHARED_CIRCUMSTANCES, SHARED_CLIENT_GTA, SHARED_CLIENT_PERSON, SHARED_INSURER_POSITION, SHARED_OWN_INSURER, SHARED_TP_VEHICLE } from "@/lib/db/shared-fields";
import { SaveClashNotice } from "@/components/SaveClashNotice";
import { HireEndDateReview } from "@/components/claims/HireEndDateReview";
import { TotalLossPanel } from "@/components/claims/TotalLossPanel";
import { StorageDateReview } from "@/components/claims/StorageDateReview";
import { StorageEndDateReview } from "@/components/claims/StorageEndDateReview";
import { getHireEndDateReviews } from "@/lib/db/hire-collection-date";
import { getStorageDateReview, getStorageEndDateReview } from "@/lib/db/storage-recovery-date";
import { claimStorageChargeEnded, storageAuthorisationEndForClaim } from "@/lib/db/storage-authorisation-end";
import { ChargeableStorageNote, StorageAuthorisationEndPanel } from "@/components/claims/StorageAuthorisationEnd";
import { MailboxSendNotice } from "@/components/claims/SendPreparedEmailForm";
import { RecordRepairSteps } from "@/components/claims/RecordRepairSteps";
import { EmailSendModeBanner } from "@/components/EmailSendModeBanner";
import { liveEmailSending } from "@/lib/email/send-mode";
import { listCasInsuranceDocuments } from "@/lib/db/company-insurance";

export async function ClaimWorkScreen({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; screen: string }>;
  searchParams: Promise<{ saved?: string; error?: string; field?: string; whatsapp?: string; clash?: string; tlError?: string; tlMail?: string; mailboxError?: string; mailboxSent?: string; mailboxSimulated?: string; mailboxReport?: string; stepError?: string; stepSaved?: string }>;
}) {
  const { id, screen } = await params;
  if (screen === "storage" || screen === "recovery") redirect(headScreenPath(id, screen));
  if (screen === "reserve" || screen === "hire-vehicle") redirect(`/claims/${id}/hire#car`);
  if (screen === "delivery-collection") redirect(`/claims/${id}/hire#handover`);
  await requireStaff();
  const { saved, error, field, whatsapp, clash, tlError, tlMail, mailboxError, mailboxSent, mailboxSimulated, mailboxReport, stepError, stepSaved } = await searchParams;
  const def = getClaimScreen(screen);
  if (!def) notFound();
  const data = getClaim(id);
  if (!data) notFound();
  const loadedValues = seedScreenDefaults(String(data.claim.id), screen);
  const screenClash = loadClash(clash);
  const claimId = String(data.claim.id);
  const sharedScopes =
    screen === "accident"
      ? [SHARED_CIRCUMSTANCES]
      : screen === "insurer"
        ? [SHARED_OWN_INSURER]
        : screen === "client"
          ? [SHARED_CLIENT_PERSON]
          : screen === "vehicle"
            ? [SHARED_CLIENT_GTA, SHARED_TP_VEHICLE]
            : screen === "tp1"
              ? [SHARED_TP_VEHICLE]
              : [];
  const clashForScreen =
    screenClash &&
    ((screenClash.scope === "screen" && screenClash.recordKey === `${claimId}:${screen}`) ||
      (sharedScopes.includes(screenClash.scope) && screenClash.recordKey === claimId))
      ? screenClash
      : null;
  const values = clashForScreen ? { ...loadedValues, ...clashForScreen.submitted } : loadedValues;
  const recordVersion =
    clashForScreen && clashForScreen.scope === "screen" ? clashForScreen.expectedVersion : screenVersion(claimId, screen);
  const extraHidden = sharedVersionFields(claimId, screen);
  if (clashForScreen && clashForScreen.scope !== "screen") {
    const tokenName = Object.keys(extraHidden).find((name) => {
      if (name === "circumstancesVersion") return clashForScreen.scope === SHARED_CIRCUMSTANCES;
      if (name === "ownInsurerVersion") return clashForScreen.scope === SHARED_OWN_INSURER;
      if (name === "clientPersonVersion") return clashForScreen.scope === SHARED_CLIENT_PERSON;
      if (name === "clientGtaVersion") return clashForScreen.scope === SHARED_CLIENT_GTA;
      if (name === "tpVehicleVersion") return clashForScreen.scope === SHARED_TP_VEHICLE;
      return false;
    });
    if (tokenName) extraHidden[tokenName] = clashForScreen.expectedVersion;
  }
  const actorId = String(data.claim.handler_id || "staff-sian");
  const justSaved = saved === "1";
  const preparedRow = findPreparedEngineerInstruction(String(data.claim.id));
  const preparedEngineerInstruction = preparedRow
    ? {
        id: String(preparedRow.id),
        subject: preparedRow.subject,
        to_address: preparedRow.to_address,
        body: preparedRow.body,
        created_at: String(preparedRow.created_at),
      }
    : null;
  const chases = listChasesForClaim(String(data.claim.id));
  const hireAgreements = listHireAgreements(String(data.claim.id));
  const preparedByKind = Object.fromEntries(
    chases.map((chase) => {
      const preparedChaseRow = isChaseKind(chase.kind) ? findPreparedChase(chase.kind, String(data.claim.id)) : null;
      return [
        chase.kind,
        preparedChaseRow
          ? {
              id: String(preparedChaseRow.id),
              subject: preparedChaseRow.subject,
              to_address: preparedChaseRow.to_address,
              body: preparedChaseRow.body,
              created_at: String(preparedChaseRow.created_at),
            }
          : null,
      ];
    }),
  );

  return (
    <div className="space-y-4">
      <PageHeader title={def.label} subtitle={def.hint} />
      {error ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p>
      ) : null}
      <SaveClashNotice clash={clashForScreen} reloadHref={`/claims/${data.claim.id}/work/${screen}`} />
      <EmailSendModeBanner />
      <MailboxSendNotice sent={mailboxSent} simulated={mailboxSimulated} error={mailboxError} reportNotice={mailboxReport} />
      {screen === "storage" || screen === "recovery" ? (
        <StorageDateReview
          claimId={String(data.claim.id)}
          review={getStorageDateReview(String(data.claim.id))}
          returnTo={`/claims/${data.claim.id}/work/${screen}`}
        />
      ) : null}
      {screen === "storage" ? (
        <div className="space-y-3">
          <StorageEndDateReview
            claimId={String(data.claim.id)}
            review={getStorageEndDateReview(String(data.claim.id))}
            returnTo={`/claims/${data.claim.id}/work/storage`}
          />
          <StorageAuthorisationEndPanel
            claimId={String(data.claim.id)}
            decision={storageAuthorisationEndForClaim(String(data.claim.id))}
            returnTo={`/claims/${data.claim.id}/work/storage`}
          />
          <ChargeableStorageNote
            ended={claimStorageChargeEnded(String(data.claim.id))}
            endDay={data.claim.storage_billing_end_on ? String(data.claim.storage_billing_end_on) : null}
          />
        </div>
      ) : null}
      {screen === "assessed-damage" ? (
        <RecordRepairSteps
          claimId={String(data.claim.id)}
          mode="inspection"
          returnTo={`/claims/${data.claim.id}/work/assessed-damage`}
          error={stepError}
          saved={stepSaved}
          showSimulatedReport={!liveEmailSending()}
        />
      ) : null}
      {screen === "assessed-damage" && Number(data.claim.total_loss) === 1 ? (
        <div className="space-y-3">
          <div className="rounded-md border border-teal/40 bg-[#e8f4f2] px-4 py-3 text-sm">
            <p className="font-semibold text-navy-deep">This section updates the vehicle damage ledger.</p>
            <p className="mt-1">
              Pre-accident value, salvage and the insurer offer saved in the panel below are written to that ledger. The engineer&apos;s notes further down are not.
            </p>
            <Link href={headScreenPath(String(data.claim.id), "repairs")} className="mt-2 inline-block font-semibold text-teal-dark underline">
              Open the vehicle damage ledger
            </Link>
          </div>
          <TotalLossPanel
            claimId={String(data.claim.id)}
            totalLoss
            returnTo={`/claims/${data.claim.id}/work/assessed-damage`}
            error={tlError}
            openMailId={tlMail}
          />
        </div>
      ) : null}
      {screen === "delivery-collection" ? (
        <HireEndDateReview
          claimId={String(data.claim.id)}
          reviews={getHireEndDateReviews(String(data.claim.id))}
          returnTo={`/claims/${data.claim.id}/work/delivery-collection`}
        />
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
            ownInsurerEmail: savedText(getScreenData(String(data.claim.id), "insurer").email),
            tpPhone: String(data.thirdParties[0]?.insurer_tel || data.thirdParties[0]?.handler_tel || ""),
            representativeRecorded: representativeIsRecorded(data.thirdParties[0]),
            representativeEmail: savedText(String(data.thirdParties[0]?.agent_email || "")) || savedText(String(data.thirdParties[0]?.agent_handler_email || "")),
            engineerInstructed: Boolean(String(data.claim.engineer_id || "").trim()),
            engineerEmail: savedText(getEngineer(String(data.claim.engineer_id || ""))?.email),
            fileReference: String(data.claim.file_reference),
            policyRef: String(data.thirdParties[0]?.insurer_ref || data.thirdParties[0]?.policy_number || data.claim.own_policy_ref || ""),
          }}
          correspondence={data.correspondence.map((row) => ({ ...row }))}
          documents={data.documents.map((row) => ({ ...row }))}
          companyDocuments={listCasInsuranceDocuments().map((row) => ({ ...row }))}
          liabilityStatus={String(data.claim.claim_type || "")}
          engineers={listActiveEngineers()}
          selectedEngineerId={String(data.claim.engineer_id || "")}
          preparedEngineerInstruction={preparedEngineerInstruction}
          chases={chases}
          hireAgreements={hireAgreements}
          preparedByKind={preparedByKind}
          mailboxConnected={liveEmailSending()}
          impecuniosityBlockReason={impecuniosityGate(String(data.claim.id)).generationBlock}
          engineerVersion={sectionVersion("claim-engineer", String(data.claim.id))}
          insurerPositionVersion={sectionVersion(SHARED_INSURER_POSITION, String(data.claim.id))}
          repairVersion={sectionVersion("money", `${data.claim.id}:repairs`)}
          overrideVersions={Object.fromEntries(
            chases.map((chase) => [chase.kind, sectionVersion("chase-override", `${data.claim.id}:${chase.kind}`)]),
          )}
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
          recordVersion={recordVersion}
          extraHidden={extraHidden}
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
              <Link href={workScreenTabPath(claimId, screen.key)} className="text-xs font-semibold text-teal-dark">
                GO TO
              </Link>
            </div>
          )),
      )}
      <p className="sm:col-span-2 text-xs text-slate">{CLAIM_SCREENS.length} screens on this file, matching the current CRM viewing pane.</p>
    </div>
  );
}

export default async function Page({ params }: { params: Promise<{ id: string; screen: string }> }) {
  const { id, screen } = await params;
  redirect(workScreenTabPath(id, screen));
}
