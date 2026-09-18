import { actionUpdateClaimStatus } from "@/app/actions";
import {
  LIABILITY_STATUS_OPTIONS,
  ROADWORTHINESS_OPTIONS,
  liabilityStatusLabel,
  normalizeLiabilityStatus,
  normalizeRoadworthiness,
  roadworthinessLabel,
} from "@/lib/domain/claim-status";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export function ClaimWorkflowStatus({
  claimId,
  liabilityStatus,
  roadworthiness,
}: {
  claimId: string;
  liabilityStatus: string | null | undefined;
  roadworthiness: string | null | undefined;
}) {
  const liability = normalizeLiabilityStatus(liabilityStatus);
  const vehicle = normalizeRoadworthiness(roadworthiness);

  return (
    <section className="rounded-xl border-2 border-navy bg-[#e8eef4] p-5">
      <h2 className="font-serif text-xl text-navy-deep">Liability and roadworthiness</h2>
      <p className="mt-1 text-sm text-slate">
        These two facts are independent. Leave either as not yet decided rather than guessing. Disputed / unclear is a
        valid liability status. Changing one does not change the other. Hire charges still do not start just because this
        file is open.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <form action={actionUpdateClaimStatus} className="space-y-2 rounded-lg border border-line bg-white p-4">
          <input type="hidden" name="claimId" value={claimId} />
          <input type="hidden" name="field" value="liability" />
          <label className="block text-sm font-medium">
            Liability status
            <select name="liabilityStatus" className={field} defaultValue={liability} key={`liability-${liability}`}>
              {LIABILITY_STATUS_OPTIONS.map((option) => (
                <option key={option.value || "unset"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-slate">Current: {liabilityStatusLabel(liability)}</p>
          <button className="rounded-md bg-navy px-3 py-2 text-sm text-white" type="submit">
            Save liability status
          </button>
        </form>
        <form action={actionUpdateClaimStatus} className="space-y-2 rounded-lg border border-line bg-white p-4">
          <input type="hidden" name="claimId" value={claimId} />
          <input type="hidden" name="field" value="roadworthiness" />
          <label className="block text-sm font-medium">
            Roadworthiness
            <select name="roadworthiness" className={field} defaultValue={vehicle} key={`roadworthiness-${vehicle}`}>
              {ROADWORTHINESS_OPTIONS.map((option) => (
                <option key={option.value || "unset"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-slate">Current: {roadworthinessLabel(vehicle)}</p>
          <button className="rounded-md bg-navy px-3 py-2 text-sm text-white" type="submit">
            Save roadworthiness
          </button>
        </form>
      </div>
    </section>
  );
}

export function ClaimWorkflowStatusSummary({
  liabilityStatus,
  roadworthiness,
}: {
  liabilityStatus: string | null | undefined;
  roadworthiness: string | null | undefined;
}) {
  return (
    <p className="text-sm text-slate">
      Liability: <strong className="text-navy-deep">{liabilityStatusLabel(liabilityStatus)}</strong>
      {" · "}
      Roadworthiness: <strong className="text-navy-deep">{roadworthinessLabel(roadworthiness)}</strong>
    </p>
  );
}
