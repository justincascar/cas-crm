import Link from "next/link";
import type { ReactNode } from "react";
import { HirePackScreen } from "@/app/claims/[id]/hire-pack/page";
import { PrehireChecksScreen } from "@/app/claims/[id]/prehire/page";
import { SaveClashNotice } from "@/components/SaveClashNotice";
import { SubmitKeyInput } from "@/components/SubmitKeyInput";
import { formatUkDate, formatUkDateTime, londonTodayIso } from "@/lib/dates";
import type { HireArea, HireCarChoice } from "@/lib/db/hire-choice";
import type { SaveClashView } from "@/lib/db/record-version";
import { FUEL_LEVELS } from "@/lib/db/handover";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";
const button = "inline-flex min-h-11 items-center rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white";
const quiet = "inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-navy";
const fileAccept = "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp,.gif";

function waitingFor(gaps: HireArea["gaps"]): string {
  const parts: string[] = [];
  if (gaps.some((gap) => gap.kind !== "bank")) parts.push("licence check");
  if (gaps.some((gap) => gap.kind === "bank")) parts.push("bank statements");
  return parts.join(", ");
}

function checkError(error: string | undefined): boolean {
  return Boolean(error && /licence|bank statement|no bank|older than|will drive/i.test(error));
}

function gapHref(claimId: string, href: string) {
  return href.startsWith("#") ? `/claims/${claimId}/hire${href}` : href;
}

function carOption(car: HireCarChoice) {
  return `${car.label} · ${car.transmission || "transmission not recorded"} · ${car.seats ?? "seats not recorded"}${car.seats ? " seats" : ""}`;
}

/** A finished step: one line with a Change button. The form opens underneath. */
function DoneLine({ summary, children, open = false }: { summary: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="mt-2" open={open || undefined}>
      <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 text-sm">
        <span data-done-line>{summary}</span>
        <span className="text-teal-dark underline">Change</span>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

export function HireJourney({
  area,
  error,
  saved,
  clash,
  handlers,
  mayOverride,
  showPack,
}: {
  area: HireArea;
  error?: string;
  saved?: string;
  clash: SaveClashView | null;
  handlers: Array<{ id: string; name: string }>;
  mayOverride: boolean;
  showPack: boolean;
}) {
  const id = area.claimId;
  const carLabel = area.creditHire ? "hire car" : "courtesy car";
  const yes = area.need === "yes";
  const carDone = Boolean(area.chosen);
  const checksDone = area.checksDone;
  const agreementDone = area.agreementCount > 0;
  const started = Boolean(area.startedAt);
  const wait = waitingFor(area.gaps);
  const refusedChecks = checkError(error);
  const filters = area.filters;
  const signedNeeded = area.creditHire && !area.signed && !area.signedOverride;
  const box = (active: boolean) =>
    `scroll-mt-16 rounded-xl p-5 ${active ? "border border-overdue bg-[#f8ecec]" : "border border-line bg-card"}`;
  const agreementStillNeeded = [
    ...area.gaps.map((gap) => ({ key: `check-${gap.key}`, label: gap.label, href: gapHref(id, gap.href) })),
    ...area.agreementGaps,
  ];
  const handoverWaiting = [
    !carDone ? "a car" : "",
    area.rateMissing ? "the daily rate" : "",
    !checksDone ? wait : "",
  ].filter(Boolean);
  const deliveryWords =
    area.delivery?.method === "deliver"
      ? `delivery · ${area.delivery.assigneeName ? `driver ${area.delivery.assigneeName}` : "driver not chosen"}`
      : "client collects";
  const plannedWords = area.delivery?.date
    ? `${formatUkDate(area.delivery.date)}${area.delivery.time ? ` ${area.delivery.time}` : ""}`
    : "";

  const reserveForm = (
    <>
      <form method="get" action={`/claims/${id}/hire`} className="grid gap-3 sm:grid-cols-5" data-car-filters>
        <label className="text-sm">
          From
          <input type="date" name="date" className={field} defaultValue={filters.date} />
        </label>
        <label className="text-sm">
          Gearbox
          <select name="transmission" className={field} defaultValue={filters.transmission}>
            <option value="">Any</option>
            <option value="manual">Manual</option>
            <option value="automatic">Automatic</option>
          </select>
        </label>
        <label className="text-sm">
          Seats at least
          <input name="seats" inputMode="numeric" className={field} defaultValue={filters.seats} />
        </label>
        <label className="text-sm">
          Class
          <input name="class" className={field} defaultValue={filters.vehicleClass} />
        </label>
        <div className="flex items-end gap-3">
          <button className={quiet} type="submit">
            Show cars
          </button>
        </div>
      </form>
      <p className="mt-2 text-sm">
        <Link href={`/claims/${id}/hire?date=${filters.date}&transmission=&seats=&class=#car`} className="text-teal-dark underline">
          Show every free car
        </Link>
      </p>
      <form method="post" action={`/claims/${id}/hire/choose`} className="mt-4 space-y-3">
        <SubmitKeyInput />
        <input type="hidden" name="returnHash" value="#car" />
        {[...area.cars, ...area.carsMissingDetails].map((car) => (
          <input key={car.id} type="hidden" name={`fleetVersion_${car.id}`} value={car.version} />
        ))}
        <label className="block text-sm">
          Car
          <select name="fleetVehicleId" className={field} required defaultValue={area.chosen?.fleetVehicleId || ""}>
            <option value="" disabled>
              {area.cars.length || area.carsMissingDetails.length ? "Choose one" : "No free car for these dates"}
            </option>
            {area.cars.length ? (
              <optgroup label="Free and matching">
                {area.cars.map((car) => (
                  <option key={car.id} value={car.id}>
                    {carOption(car)}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {area.carsMissingDetails.length ? (
              <optgroup label="Details missing – check before offering">
                {area.carsMissingDetails.map((car) => (
                  <option key={car.id} value={car.id}>
                    {carOption(car)}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            How the client gets the car
            <select name="method" className={field} required defaultValue={area.delivery?.method || "deliver"}>
              <option value="deliver">Deliver to the client</option>
              <option value="collect">Client collects</option>
            </select>
          </label>
          <label className="text-sm">
            Driver for the delivery
            <select name="driverId" className={field} defaultValue={area.delivery?.assigneeId || ""} data-driver-select>
              <option value="">Unassigned – choose later</option>
              {handlers.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Date
            <input type="date" name="date" required className={field} defaultValue={area.delivery?.date || filters.date || londonTodayIso()} />
          </label>
          <label className="text-sm">
            Time
            <input type="time" name="time" required className={field} defaultValue={area.delivery?.time || "09:00"} />
          </label>
        </div>
        <label className="block text-sm">
          Delivery address
          <input name="address" className={field} defaultValue={area.delivery?.address || area.address} />
        </label>
        <button className={button} type="submit">
          {area.chosen ? "Save car" : "Reserve this car"}
        </button>
      </form>
    </>
  );

  const rateBlock = area.creditHire && carDone ? (
    <div id="rate" className="mt-4 scroll-mt-16" data-rate={area.rateMissing ? "missing" : "stored"}>
      {area.rateMissing ? (
        <div className="rounded-md border border-overdue/40 bg-[#f8ecec] p-3">
          <p className="text-sm font-semibold text-overdue">Daily rate missing</p>
          <p className="mt-1 text-sm">Choose the group charged. The rate for that group is taken from Settings and kept on this hire.</p>
          <RateForm claimId={id} group={area.groupCharged || area.clientGroup || ""} groups={area.rateGroups} label="Set the daily rate" />
        </div>
      ) : area.canChangeRate ? (
        <DoneLine summary={<>Daily rate: {area.rate.line}</>}>
          <RateForm claimId={id} group={area.groupCharged || ""} groups={area.rateGroups} label="Take the rate again from Settings" />
        </DoneLine>
      ) : (
        <p className="text-sm" data-rate-line>
          Daily rate: {area.rate.line}
        </p>
      )}
    </div>
  ) : null;

  return (
    <div className="space-y-6">
      <SaveClashNotice clash={clash} reloadHref={`/claims/${id}/hire`} />
      {error ? (
        <div data-form-error className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">
          <p>{error}</p>
          {refusedChecks && area.gaps.length > 0 ? (
            <ul className="mt-2 list-disc pl-5">
              {area.gaps.map((gap) => (
                <li key={gap.key}>
                  <Link href={gapHref(id, gap.href)} className="underline">
                    {gap.label}
                  </Link>
                </li>
              ))}
            </ul>
          ) : /hire agreement was not produced/i.test(error) && area.agreementGaps.length > 0 ? (
            <ul className="mt-2 list-disc pl-5">
              {area.agreementGaps.map((gap) => (
                <li key={gap.key}>
                  <Link href={gap.href} className="underline">
                    {gap.label}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {saved && !error ? <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm text-ok">Saved.</p> : null}
      {area.rateMissing && started ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue" data-rate-warning>
          Daily rate missing on this hire.{" "}
          <Link href={`/claims/${id}/hire#rate`} className="underline">
            Set the daily rate
          </Link>
        </p>
      ) : null}

      <ol className="space-y-4">
        <li id="need" data-hire-step="1" data-status={yes ? "done" : "next"} className={box(false)}>
          <StepHead n={1} title={area.creditHire ? "Hire needed" : "Courtesy car needed"} status={yes ? "Done" : "Next"} />
          {yes ? (
            <DoneLine summary={<>Yes{area.creditHire ? ` · ${area.hireReason ? `why: ${area.hireReason}` : "reason not recorded yet"}` : ""}</>}>
              <NeedForm area={area} />
            </DoneLine>
          ) : (
            <div className="mt-4">
              <NeedForm area={area} />
            </div>
          )}
        </li>

        {yes ? (
          <li id="car" data-hire-step="2" data-status={carDone ? "done" : "next"} className={box(Boolean(error && /choose a car|just been booked|not available|held back/i.test(error)))}>
            <StepHead n={2} title="Choose a car" status={carDone ? "Done" : "Next"} />
            {area.chosen ? (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm" data-chosen-car={area.chosen.registration}>
                  <span data-car-summary>
                    {area.chosen.label || area.chosen.registration}
                    {started
                      ? ` · on hire since ${formatUkDateTime(area.startedAt)}`
                      : ` · reserved for ${plannedWords || "a date not set"} · ${deliveryWords}`}
                  </span>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-teal-dark underline">Change car</summary>
                  <div className="mt-4">{reserveForm}</div>
                </details>
                {!started ? (
                  <form method="post" action={`/claims/${id}/hire/cancel`} className="mt-2">
                    <SubmitKeyInput />
                    <input type="hidden" name="returnHash" value="#car" />
                    <button className="text-sm text-teal-dark underline" type="submit">
                      Cancel the reservation
                    </button>
                  </form>
                ) : null}
                {rateBlock}
              </>
            ) : (
              <div className="mt-3">
                <p className="text-sm">Only free cars are listed. Reserving does not start hire charges.</p>
                <div className="mt-3">{reserveForm}</div>
              </div>
            )}
          </li>
        ) : null}

        {yes ? (
          <li id="checks" data-hire-step="3" data-status={checksDone ? "done" : "next"} className={box(refusedChecks)}>
            <StepHead n={3} title="Pre-hire checks" status={checksDone ? "Done" : "Next"} />
            {checksDone ? (
              <DoneLine summary={area.creditHire ? "Licence check and bank statements done" : "Licence check done"}>
                <PrehireChecksScreen params={Promise.resolve({ id })} />
              </DoneLine>
            ) : (
              <>
                {!refusedChecks ? (
                  <p className="mt-2 text-sm" data-still-needed>
                    Still needed: {wait}.
                  </p>
                ) : null}
                <div className="mt-4">
                  <PrehireChecksScreen params={Promise.resolve({ id })} />
                </div>
              </>
            )}
          </li>
        ) : null}

        {yes && area.creditHire ? (
          <li
            id="pack"
            data-hire-step="4"
            data-status={agreementDone ? "done" : "next"}
            className={box(Boolean(error && /hire agreement was not produced/i.test(error)))}
          >
            <StepHead n={4} title="Hire agreement" status={agreementDone ? "Done" : "Next"} />
            <p className="mt-2 text-sm" data-pack-licence>
              Licence number: {area.licenceNumber || "not on the file yet"}
            </p>
            {agreementDone && area.agreement ? (
              <DoneLine
                summary={
                  <>
                    <Link href={`/documents/${area.agreement.id}`} className="text-teal-dark underline">
                      {area.agreement.title}
                    </Link>{" "}
                    · filed {formatUkDate(area.agreement.createdAt)} ·{" "}
                    {area.esign?.status === "signed"
                      ? `signed electronically by ${area.esign.signerName} on ${formatUkDateTime(area.esign.signedAt)}`
                      : area.signed
                        ? "signed copy on file"
                        : "not signed yet"}
                  </>
                }
                open={showPack}
              >
                <AgreementBody claimId={id} stillNeeded={agreementStillNeeded} showPack={showPack} again />
              </DoneLine>
            ) : (
              <AgreementBody claimId={id} stillNeeded={agreementStillNeeded} showPack={showPack} again={false} />
            )}
            {agreementDone && !area.signed && !started ? (
              <div className="mt-4 space-y-3 border-t border-line pt-4 text-sm" data-get-signed>
                <p className="font-semibold">Get it signed</p>
                {area.esign?.status === "sent" ? (
                  <p data-link-sent>
                    Signing link sent to {area.esign.sentTo} on {formatUkDateTime(area.esign.requestedAt)}. Waiting for the client.
                  </p>
                ) : null}
                <form method="post" action={`/claims/${id}/hire/esign-link`} className="flex flex-wrap items-end gap-3">
                  <SubmitKeyInput />
                  <input type="hidden" name="returnHash" value="#pack" />
                  <label className="min-w-0 flex-1">
                    Client&apos;s email
                    <input name="to" type="email" required defaultValue={area.email} className={field} />
                  </label>
                  <button className={button} type="submit">
                    {area.esign?.status === "sent" ? "Send a new link" : "Send signing link"}
                  </button>
                </form>
                <p>
                  <Link href={`/claims/${id}/sign`} className="text-teal-dark underline">
                    Client signs on this screen
                  </Link>
                </p>
                <form
                  method="post"
                  action={`/claims/${id}/hire/signed`}
                  encType="multipart/form-data"
                  className="flex flex-wrap items-end gap-3"
                  data-signed-before
                >
                  <SubmitKeyInput />
                  <input type="hidden" name="returnHash" value="#pack" />
                  <label className="min-w-0 flex-1">
                    Or upload the signed paper copy (photograph or PDF)
                    <input name="signedAgreement" type="file" required accept={fileAccept} className={field} />
                  </label>
                  <button className={quiet} type="submit">
                    Upload signed copy
                  </button>
                </form>
              </div>
            ) : null}
          </li>
        ) : null}

        {yes ? (
          <li
            id="handover"
            data-hire-step={area.creditHire ? "5" : "4"}
            data-status={started ? "done" : handoverWaiting.length ? "waiting" : "next"}
            className={box(Boolean(error && /handover was not completed|choose a car before the handover|signed/i.test(error)))}
          >
            <StepHead
              n={area.creditHire ? 5 : 4}
              title="Handover"
              status={started ? "Done" : handoverWaiting.length ? "Waiting" : "Next"}
            />
            {started ? (
              <p className="mt-2 text-sm" data-done-line>
                Handed over {formatUkDateTime(area.startedAt)}. Hire has started.
              </p>
            ) : (
              <>
                {handoverWaiting.length ? (
                  <p className="mt-2 text-sm" data-still-needed>
                    Waiting for: {handoverWaiting.join(", ")}.
                  </p>
                ) : null}
                {!carDone ? (
                  <p className="mt-3">
                    <Link href={`/claims/${id}/hire#car`} className={button}>
                      Choose a car
                    </Link>
                  </p>
                ) : null}
                {area.chosen ? (
                  <form method="post" action={`/claims/${id}/hire/handover`} encType="multipart/form-data" className="mt-4 space-y-3">
                    <p className="text-sm" data-handover-car={area.chosen.registration}>
                      {area.chosen.label || area.chosen.registration}. Completing this starts the {carLabel}.{" "}
                      <Link href={`/claims/${id}/handover`} className="text-teal-dark underline">
                        Photographs
                      </Link>
                    </p>
                    <SubmitKeyInput />
                    <input type="hidden" name="returnHash" value="#handover" />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-sm">
                        Handover date
                        <input type="date" name="date" required className={field} defaultValue={area.delivery?.date || londonTodayIso()} />
                      </label>
                      <label className="text-sm">
                        Time
                        <input type="time" name="time" required className={field} defaultValue={area.delivery?.time || "09:00"} />
                      </label>
                      <label className="text-sm">
                        Mileage out
                        <input name="mileage" type="number" min={0} step={1} required className={field} />
                      </label>
                      <label className="text-sm">
                        Fuel out
                        <select name="fuelLevel" className={field} required defaultValue="full">
                          {FUEL_LEVELS.map((level) => (
                            <option key={level.value} value={level.value}>
                              {level.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="block text-sm">
                      Who handed it over
                      <select name="driverId" className={field} required defaultValue={area.delivery?.assigneeId || handlers[0]?.id || ""}>
                        {handlers.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {signedNeeded ? (
                      <p className="text-sm">
                        <Link href={`/claims/${id}/sign`} className="text-teal-dark underline">
                          Client signs on this screen
                        </Link>
                        , or upload the signed paper copy:
                      </p>
                    ) : null}
                    {signedNeeded ? (
                      <label className="block text-sm" data-signed-upload>
                        Signed hire agreement (photograph or PDF)
                        <input name="signedAgreement" type="file" accept={fileAccept} capture="environment" required={!mayOverride} className={field} />
                      </label>
                    ) : area.creditHire ? (
                      <p className="text-sm">{area.signed ? "Signed hire agreement on file." : "Handover allowed without the signed copy (authorised)."}</p>
                    ) : null}
                    {signedNeeded && mayOverride ? (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-teal-dark underline">Hand over without the signed copy (authorised users only)</summary>
                        <label className="mt-2 block">
                          Reason
                          <textarea name="overrideReason" rows={2} maxLength={1000} className={field} />
                        </label>
                      </details>
                    ) : null}
                    <label className="block text-sm">
                      Condition note
                      <textarea name="conditionNote" className={field} rows={2} />
                    </label>
                    <button className={button} type="submit">
                      Complete handover
                    </button>
                  </form>
                ) : null}
              </>
            )}
          </li>
        ) : null}
      </ol>

      {started ? (
        <section id="on-hire" className="scroll-mt-16 rounded-xl border border-line bg-card p-5">
          <h2 className="font-serif text-xl text-navy-deep">On hire</h2>
          <p className="mt-2 text-sm">
            {area.chosen ? `${area.chosen.label} · ` : ""}
            {area.renewal || `Started ${formatUkDateTime(area.startedAt)}.`}
          </p>
          {area.creditHire && !area.signed ? (
            <form method="post" action={`/claims/${id}/hire/signed`} encType="multipart/form-data" className="mt-4 space-y-2" data-signed-after>
              <p className="text-sm font-semibold">Signed hire agreement not on file</p>
              <SubmitKeyInput />
              <input type="hidden" name="returnHash" value="#on-hire" />
              <input name="signedAgreement" type="file" required accept={fileAccept} className={field} />
              <button className={button} type="submit">
                Upload signed agreement
              </button>
            </form>
          ) : null}
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-teal-dark underline">
              {area.collectionJobId ? "Change the collection" : "Arrange collection"}
            </summary>
            <form method="post" action={`/claims/${id}/hire/collect`} className="mt-3 space-y-3">
              <p className="text-sm">Hire ends only when a handler confirms the car is back, or seven days after a qualifying total-loss payment.</p>
              <SubmitKeyInput />
              <input type="hidden" name="returnHash" value="#on-hire" />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  Date
                  <input type="date" name="date" required className={field} defaultValue={londonTodayIso()} />
                </label>
                <label className="text-sm">
                  Time
                  <input type="time" name="time" required className={field} defaultValue="09:00" />
                </label>
              </div>
              <label className="block text-sm">
                Address
                <input name="address" className={field} defaultValue={area.address} />
              </label>
              <button className={button} type="submit">
                {area.collectionJobId ? "Update collection" : "Arrange collection"}
              </button>
            </form>
          </details>
        </section>
      ) : null}
    </div>
  );
}

function NeedForm({ area }: { area: HireArea }) {
  const id = area.claimId;
  return (
    <form method="post" action={`/claims/${id}/hire/need`} className="space-y-3">
      <SubmitKeyInput />
      <input type="hidden" name="returnHash" value="#need" />
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="choice" value="yes" defaultChecked={area.need === "yes"} required />
        Yes
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="choice" value="not_yet" defaultChecked={area.need === "not_yet"} />
        Not yet – client keeps own car
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="choice" value="not_needed" defaultChecked={area.need === "no"} />
        Not needed
      </label>
      <label className="block text-sm">
        {area.creditHire ? "Why a hire car is needed (or why not)" : "Reason (needed if not needed)"}
        <textarea
          name="reason"
          className={field}
          rows={2}
          defaultValue={area.need === "no" ? area.needReason : area.creditHire ? area.hireReason : ""}
        />
      </label>
      <button className={button} type="submit">
        Save
      </button>
    </form>
  );
}

function RateForm({ claimId, group, groups, label }: { claimId: string; group: string; groups: string[]; label: string }) {
  return (
    <form method="post" action={`/claims/${claimId}/hire/rate`} className="mt-3 flex flex-wrap items-end gap-3">
      <SubmitKeyInput />
      <input type="hidden" name="returnHash" value="#rate" />
      <label className="text-sm">
        Group charged
        <select name="group" required className={field} defaultValue={group}>
          <option value="" disabled>
            Choose a group
          </option>
          {groups.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </label>
      <button className={button} type="submit">
        {label}
      </button>
      <Link href="/settings#gta-rate" className="text-sm text-teal-dark underline">
        Rates in Settings
      </Link>
    </form>
  );
}

function AgreementBody({
  claimId,
  stillNeeded,
  showPack,
  again,
}: {
  claimId: string;
  stillNeeded: Array<{ key: string; label: string; href: string }>;
  showPack: boolean;
  again: boolean;
}) {
  return (
    <div className="mt-3 space-y-3 text-sm">
      {stillNeeded.length ? (
        <div data-agreement-missing>
          <p>Still needed before the agreement:</p>
          <ul className="mt-1 list-disc pl-5">
            {stillNeeded.map((gap) => (
              <li key={gap.key}>
                <Link href={gap.href} className="text-teal-dark underline">
                  {gap.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-ok">Everything the agreement needs is on the file.</p>
      )}
      <p>Print it, have it signed, and upload the signed copy at the handover.</p>
      <form method="post" action={`/claims/${claimId}/hire/agreement`}>
        <SubmitKeyInput />
        <input type="hidden" name="returnHash" value="#pack" />
        <button className={button} type="submit">
          {again ? "Produce a new version for signature" : "Produce agreement for signature"}
        </button>
      </form>
      <details open={showPack || undefined}>
        <summary className="cursor-pointer text-teal-dark underline">Show all pack fields</summary>
        <div className="mt-3">
          <HirePackScreen params={Promise.resolve({ id: claimId })} searchParams={Promise.resolve({})} embedded />
        </div>
      </details>
    </div>
  );
}

function StepHead({ n, title, status }: { n: number; title: string; status: "Done" | "Next" | "Waiting" }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="font-serif text-xl text-navy-deep">
        {n}. {title}
      </h2>
      <p className="text-sm font-semibold text-navy">{status}</p>
    </div>
  );
}
