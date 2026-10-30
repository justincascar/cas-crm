import Link from "next/link";
import { SubmitKeyInput } from "@/components/SubmitKeyInput";
import { recoveryCardFeePercent } from "@/lib/db/recovery-fee-settings";

const HEADS = [
  { key: "recovery", label: "Recovery" },
  { key: "storage", label: "Storage" },
  { key: "hire", label: "Hire" },
  { key: "vehicle", label: "Vehicle damage" },
] as const;

export default async function ClaimMoneyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  return (
    <div className="space-y-3">
      <h2 className="font-serif text-xl text-navy-deep">Money</h2>
      {error ? <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p> : null}
      <p className="text-sm text-slate">
        A draft invoice is built from the figures on the file. It is filed here and not sent. Tick Paying by card when the payer will pay by card: a separate card fee
        line ({recoveryCardFeePercent()}% of the net amount due, plus VAT) is added.
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
    </div>
  );
}
