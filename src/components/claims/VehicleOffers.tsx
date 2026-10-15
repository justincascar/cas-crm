"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { SubmitKeyInput } from "@/components/SubmitKeyInput";
import { formatUkDate } from "@/lib/dates";
import { offerComparisonText } from "@/lib/domain/figure-resolution";
import { formatGbp } from "@/lib/money";
import type { VehicleOffer, VehicleOfferStatus } from "@/lib/db/vehicle-offers";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";
const filledField = `${field} bg-[#e7f3f2] outline outline-2 outline-[#1c6b66]`;

function ukDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function pounds(pence: number): string {
  return (pence / 100).toFixed(2);
}

function closedLabel(status: VehicleOfferStatus): string | null {
  if (status === "withdrawn") return "Withdrawn";
  if (status === "lapsed") return "Lapsed";
  if (status === "rejected") return "Rejected";
  return null;
}

export function VehicleOffers({
  claimId,
  totalLoss,
  offers,
  undatedOfferPence,
  agreedOn,
  hasAgreed,
  returnPath,
  offerHead,
  claimedPence = null,
  claimedUnderReview = false,
  showDayRate = false,
}: {
  claimId: string;
  totalLoss: boolean;
  offers: VehicleOffer[];
  undatedOfferPence: number | null;
  agreedOn: string | null;
  hasAgreed: boolean;
  returnPath?: string;
  offerHead?: string;
  claimedPence?: number | null;
  claimedUnderReview?: boolean;
  showDayRate?: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [agreedOnDraft, setAgreedOnDraft] = useState("");
  const [filledTick, setFilledTick] = useState(0);
  const [filledSummary, setFilledSummary] = useState("");
  const [recording, setRecording] = useState(false);
  const recordingGuard = useRef(false);
  const agreedPanel = useRef<HTMLFormElement>(null);
  const agreedAmount = useRef<HTMLInputElement>(null);
  const action = `/claims/${claimId}/vehicle-offers`;
  const returnTo = returnPath || `/claims/${claimId}/heads/vehicle`;
  const primaryId = offers.find((offer) => offer.status === "open")?.id ?? null;
  const justFilled = filledTick > 0;

  useEffect(() => {
    if (filledTick === 0) return;
    const timer = window.setTimeout(() => setFilledTick(0), 6000);
    return () => window.clearTimeout(timer);
  }, [filledTick]);

  function useThisFigure(offer: VehicleOffer) {
    const poundsText = pounds(offer.amountPence);
    setAmount(poundsText);
    setAgreedOnDraft(offer.offeredOn);
    setFilledSummary(`${formatGbp(offer.amountPence)} from ${ukDay(offer.offeredOn)}`);
    setFilledTick((tick) => tick + 1);
    window.requestAnimationFrame(() => {
      agreedPanel.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      agreedAmount.current?.focus({ preventScroll: true });
    });
  }

  function onRecordOffer(event: FormEvent<HTMLFormElement>) {
    if (recordingGuard.current) {
      event.preventDefault();
      return;
    }
    recordingGuard.current = true;
    window.setTimeout(() => setRecording(true), 0);
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-md border border-line bg-white p-3">
        <h3 className="font-serif text-lg text-navy-deep">Offers</h3>
        <p className="mt-1 text-sm text-slate">
          An offer is what the insurer proposes. It does not become the agreed figure until you record that separately.
        </p>
        {offers.length === 0 ? <p className="mt-3 text-sm">No offers recorded.</p> : null}
        {undatedOfferPence != null ? (
          <p className="mt-3 text-sm">
            The file already has an offered figure of {formatGbp(undatedOfferPence)} with no date. It is not part of this list. Record it below if it should be kept as an offer.
          </p>
        ) : null}
        {offers.length > 0 ? (
          <ol className="mt-3 space-y-2">
            {offers.map((offer) => {
              const primary = offer.id === primaryId;
              const closed = closedLabel(offer.status);
              return (
                <li
                  key={offer.id}
                  className={
                    primary
                      ? "rounded-md border border-line px-3 py-2 text-sm"
                      : "rounded-md border border-line px-3 py-2 text-sm text-slate"
                  }
                >
                  <p className={primary ? "font-semibold" : ""}>
                    {formatGbp(offer.amountPence)} · {ukDay(offer.offeredOn)}
                    {closed ? ` · ${closed}` : ""}
                    {closed && offer.closedAt ? ` · ${formatUkDate(offer.closedAt)}` : ""}
                  </p>
                  {claimedPence != null ? (
                    <p className="mt-1">{offerComparisonText(offer.amountPence, claimedPence, claimedUnderReview)}</p>
                  ) : null}
                  {offer.offeredDays != null && offer.offeredDailyRatePence != null ? (
                    <p className="mt-1">
                      Insurer offered {offer.offeredDays} days at {formatGbp(offer.offeredDailyRatePence)} a day.
                    </p>
                  ) : null}
                  {offer.rateMismatch ? (
                    <p className="mt-1 font-semibold">
                      The offered days times the offered daily rate does not equal this offer. The offer is still recorded.
                    </p>
                  ) : null}
                  {offer.note ? <p className="mt-1">{offer.note}</p> : null}
                  {offer.status === "rejected" && offer.closedNote ? <p className="mt-1">Rejection note: {offer.closedNote}</p> : null}
                  {offer.status === "open" ? (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <button
                        type="button"
                        className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-semibold text-navy"
                        onClick={() => useThisFigure(offer)}
                      >
                        Use this figure
                      </button>
                      <form method="post" action={action}>
                        <input type="hidden" name="returnTo" value={returnTo} />
                        {offerHead ? <input type="hidden" name="head" value={offerHead} /> : null}
                        <input type="hidden" name="intent" value="withdraw" />
                        <input type="hidden" name="offerId" value={offer.id} />
                        <button className="rounded-md border border-line bg-white px-3 py-1.5 text-sm" type="submit">
                          Mark as withdrawn
                        </button>
                      </form>
                      <form method="post" action={action}>
                        <input type="hidden" name="returnTo" value={returnTo} />
                        {offerHead ? <input type="hidden" name="head" value={offerHead} /> : null}
                        <input type="hidden" name="intent" value="lapse" />
                        <input type="hidden" name="offerId" value={offer.id} />
                        <button className="rounded-md border border-line bg-white px-3 py-1.5 text-sm" type="submit">
                          Mark as lapsed
                        </button>
                      </form>
                      <form method="post" action={action} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="returnTo" value={returnTo} />
                        {offerHead ? <input type="hidden" name="head" value={offerHead} /> : null}
                        <input type="hidden" name="intent" value="reject" />
                        <input type="hidden" name="offerId" value={offer.id} />
                        <label className="block text-sm">
                          Rejection note
                          <input name="note" className={field} placeholder="Optional. Why it was declined." />
                        </label>
                        <button className="rounded-md border border-line bg-white px-3 py-1.5 text-sm" type="submit">
                          Reject
                        </button>
                      </form>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : null}
        <form method="post" action={action} className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={onRecordOffer}>
          <SubmitKeyInput />
          <input type="hidden" name="returnTo" value={returnTo} />
          {offerHead ? <input type="hidden" name="head" value={offerHead} /> : null}
          <input type="hidden" name="intent" value="record_offer" />
          <label className="block text-sm">
            Amount (£)
            <input name="amount" inputMode="decimal" required className={field} />
          </label>
          <label className="block text-sm">
            Date of the offer
            <input name="offeredOn" type="date" required className={field} />
          </label>
          {showDayRate ? (
            <>
              <label className="block text-sm">
                Insurer&apos;s offered days
                <input name="offeredDays" inputMode="numeric" className={field} />
                <span className="mt-1 block text-slate">Optional. Leave blank if the insurer did not state the days.</span>
              </label>
              <label className="block text-sm">
                Insurer&apos;s offered daily rate (£)
                <input name="offeredDailyRate" inputMode="decimal" className={field} />
                <span className="mt-1 block text-slate">Optional. If both are entered and they do not multiply to the offer, the mismatch is flagged. The offer is still recorded.</span>
              </label>
            </>
          ) : null}
          <label className="block text-sm sm:col-span-2">
            Note
            <input name="note" className={field} placeholder="For example, subject to the engineer’s report" />
            <span className="mt-1 block text-slate">Optional. Leave it blank if there is nothing to add.</span>
          </label>
          <div className="sm:col-span-2">
            <button className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-60" type="submit" disabled={recording}>
              {recording ? "Recording offer…" : "Record offer"}
            </button>
          </div>
        </form>
      </div>

      <form
        ref={agreedPanel}
        method="post"
        action={action}
        className="scroll-mt-24 rounded-md border border-line bg-white p-3"
      >
        <SubmitKeyInput />
        <input type="hidden" name="returnTo" value={returnTo} />
        {offerHead ? <input type="hidden" name="head" value={offerHead} /> : null}
        <input type="hidden" name="intent" value="record_agreed" />
        <h3 className="font-serif text-lg text-navy-deep">Agreed</h3>
        {justFilled ? (
          <p className="mt-2 rounded-md border border-[#1c6b66] bg-[#e7f3f2] px-3 py-2 text-sm" role="status">
            Filled in from the offer of {filledSummary}. Change either box if you need to. Nothing is saved until you record the agreed figure.
          </p>
        ) : null}
        {hasAgreed && agreedOn ? (
          <p className="mt-1 text-sm">Agreement reached on {ukDay(agreedOn)}.</p>
        ) : hasAgreed ? (
          <p className="mt-1 text-sm">The agreed figure does not have a date yet. Enter the date when you record or correct it.</p>
        ) : (
          <p className="mt-1 text-sm text-slate">Nothing is agreed until you record it here. An offer does not fill this in on its own.</p>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            {totalLoss ? "Agreed amount (£)" : "Agreed repair invoice (£)"}
            <input
              ref={agreedAmount}
              name="agreed"
              inputMode="decimal"
              required
              className={justFilled ? filledField : field}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <span className="mt-1 block text-slate">
              {totalLoss
                ? "This is the agreed vehicle-damage figure. It does not change the amount received."
                : "This is the agreed repair figure only. It does not include storage, and it does not change the amount received."}
            </span>
          </label>
          <label className="block text-sm">
            Date agreement was reached
            <input
              name="agreedOn"
              type="date"
              required
              className={justFilled ? filledField : field}
              value={agreedOnDraft}
              onChange={(event) => setAgreedOnDraft(event.target.value)}
            />
            <span className="mt-1 block text-slate">Use this figure copies an offer in so you can change it before saving.</span>
          </label>
        </div>
        <button className="mt-3 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white" type="submit">
          {totalLoss ? "Save this as the agreed amount" : "Record agreed figure"}
        </button>
      </form>
    </div>
  );
}
