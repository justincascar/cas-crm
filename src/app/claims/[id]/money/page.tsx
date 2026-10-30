import Link from "next/link";
import { SubmitKeyInput } from "@/components/SubmitKeyInput";
import { recoveryCardFeePercent } from "@/lib/db/recovery-fee-settings";

const HEADS = [
  { key: "recovery", label: "Recovery" },
  { key: "storage", label: "Storage" },
  { key: "hire", label: "Hire" },
  { key: "vehicle", label: "Vehicle damage" },
] as const;

/** Heads one payment can be split across. Each part goes on its own head only. */
const SPLIT_HEADS = [
  { key: "recovery", label: "Recovery" },
  { key: "storage", label: "Storage" },
  { key: "hire", label: "Hire" },
  { key: "repairs", label: "Repairs" },
  { key: "vehicle_damage", label: "Vehicle damage (total loss)" },
] as const;

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export default async function ClaimMoneyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  return (
    <div className="space-y-3">
      <h2 className="font-serif text-xl text-navy-deep">Money</h2>
      {error ? <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p> : null}
      {saved === "split" && !error ? (
        <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm text-ok">Payment split by head and recorded. Each part is on its own head.</p>
      ) : null}
      <p className="text-sm text-slate">
        A draft invoice is built from the figures on the file. It is filed here and not sent. Tick Paying by card when the payer will pay by card: a separate card fee
        line ({recoveryCardFeePercent()}% of the amount due, VAT included, plus VAT on the fee) is added.
      </p>
      <ul className="space-y-2">
        {HEADS.map((head) => (
          <li key={head.key} className="flex flex-wrap items-center gap-3">
            <Link href={`/claims/${id}/money/${head.key}`} className="font-semibold text-teal-dark underline">
              {head.label}
            </Link>
            <form method="post" action={`/claims/${id}/invoice`} className="flex flex-wrap items-center gap-3">
              <SubmitKeyInput />
              <input type="hidden" name="head" value={head.key} />
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="payingByCard" value="yes" />
                Paying by card
              </label>
              <button type="submit" className="rounded-md border border-line bg-white px-3 py-1 text-sm text-navy">
                Draft invoice
              </button>
            </form>
          </li>
        ))}
      </ul>
      <form method="post" action={`/claims/${id}/invoice`} className="flex flex-wrap items-center gap-3">
        <SubmitKeyInput />
        <input type="hidden" name="head" value="customer" />
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" name="payingByCard" value="yes" />
          Paying by card
        </label>
        <button type="submit" className="rounded-md border border-line bg-white px-3 py-1 text-sm text-navy">
          Draft customer invoice – recovery and storage
        </button>
      </form>
      <details id="split-payment" className="scroll-mt-16 rounded-xl border border-line bg-card p-4 text-sm">
        <summary className="cursor-pointer font-semibold text-navy-deep">One payment covering several heads of loss</summary>
        <form method="post" action={`/claims/${id}/payments/split`} className="mt-3 space-y-3" data-split-payment>
          <SubmitKeyInput />
          <p className="text-slate">
            Split it by head before it is recorded. The parts must add up to the payment, and no part can be more than is outstanding on its head. Nothing is
            marked paid until it is split.
          </p>
          <label className="block max-w-xs">
            Amount of the payment (£)
            <input name="total" inputMode="decimal" required className={field} />
          </label>
          <div className="grid gap-3 sm:grid-cols-5">
            {SPLIT_HEADS.map((head) => (
              <label key={head.key} className="block">
                {head.label} (£)
                <input name={`split_${head.key}`} inputMode="decimal" className={field} />
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="payingByCard" value="yes" />
            Paying by card (a separate card fee on each part)
          </label>
          <button type="submit" className="rounded-md bg-navy px-4 py-2 font-semibold text-white">
            Record the split payment
          </button>
        </form>
      </details>
    </div>
  );
}
