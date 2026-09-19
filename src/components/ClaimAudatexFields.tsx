"use client";

import { actionUpdateAudatexCodes } from "@/app/actions";
import type { AudatexCodeSuggestion } from "@/lib/domain/audatex";
import { displayAudatexCode } from "@/lib/domain/audatex";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";
const suggestedField =
  "mt-1 w-full rounded-md border border-warn bg-[#fff6e8] px-3 py-2 text-sm";

function suggestionNote(suggestion: AudatexCodeSuggestion | null) {
  if (!suggestion) return null;
  return (
    <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-3 py-2 text-xs text-navy">
      Suggested from {suggestion.insurerName} (last saved on {suggestion.sourceFileReference}). Not yet
      confirmed on this file — overwrite if this claim uses a different code, then save.
    </p>
  );
}

export function ClaimAudatexFields({
  claimId,
  insurerName,
  networkCode,
  workProviderCode,
  suggestedNetwork,
  suggestedWorkProvider,
}: {
  claimId: string;
  insurerName: string;
  networkCode: string | null | undefined;
  workProviderCode: string | null | undefined;
  suggestedNetwork: AudatexCodeSuggestion | null;
  suggestedWorkProvider: AudatexCodeSuggestion | null;
}) {
  const network = displayAudatexCode(networkCode, suggestedNetwork);
  const provider = displayAudatexCode(workProviderCode, suggestedWorkProvider);
  const savedNetwork = (networkCode || "").trim();
  const savedProvider = (workProviderCode || "").trim();

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <h2 className="font-serif text-xl text-navy-deep">Audatex codes</h2>
      <p className="mt-1 text-sm text-slate">
        These are only known after the insurer has confirmed them. Leave them blank until then. If this
        insurer has been used on another file, the last saved codes are suggested here — they are not
        confirmed on this claim until you save. They can still differ from file to file. Changes are
        recorded in file history.
      </p>
      {!insurerName ? (
        <p className="mt-3 text-xs text-slate">
          No insurer name is set for this file yet (own insurer on a Fault claim, or the third-party
          insurer on a Non-fault claim), so nothing can be suggested.
        </p>
      ) : (
        <p className="mt-3 text-xs text-slate">Looking up previous codes for {insurerName}.</p>
      )}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <form action={actionUpdateAudatexCodes} className="space-y-2 rounded-lg border border-line bg-white p-4">
          <input type="hidden" name="claimId" value={claimId} />
          <input type="hidden" name="field" value="network" />
          <label className="block text-sm font-medium">
            Audatex network code
            <input
              name="audatexNetworkCode"
              className={network.suggestion ? suggestedField : field}
              defaultValue={network.value}
              key={`network-${savedNetwork || network.suggestion?.value || ""}`}
              autoComplete="off"
            />
          </label>
          {suggestionNote(network.suggestion)}
          <p className="text-xs text-slate">
            Current on this file: {savedNetwork || "Not yet recorded"}
          </p>
          <button className="rounded-md bg-navy px-3 py-2 text-sm text-white" type="submit">
            Save network code
          </button>
        </form>
        <form action={actionUpdateAudatexCodes} className="space-y-2 rounded-lg border border-line bg-white p-4">
          <input type="hidden" name="claimId" value={claimId} />
          <input type="hidden" name="field" value="provider" />
          <label className="block text-sm font-medium">
            Audatex work provider code
            <input
              name="audatexWorkProviderCode"
              className={provider.suggestion ? suggestedField : field}
              defaultValue={provider.value}
              key={`provider-${savedProvider || provider.suggestion?.value || ""}`}
              autoComplete="off"
            />
          </label>
          {suggestionNote(provider.suggestion)}
          <p className="text-xs text-slate">
            Current on this file: {savedProvider || "Not yet recorded"}
          </p>
          <button className="rounded-md bg-navy px-3 py-2 text-sm text-white" type="submit">
            Save work provider code
          </button>
        </form>
      </div>
    </section>
  );
}
