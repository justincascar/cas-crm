import Link from "next/link";
import { SubmitKeyInput } from "@/components/SubmitKeyInput";

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
      <p className="text-sm text-slate">A draft invoice is built from the figures on the file. It is filed here and not sent.</p>
      <ul className="space-y-2">
        {HEADS.map((head) => (
          <li key={head.key} className="flex flex-wrap items-center gap-3">
            <Link href={`/claims/${id}/money/${head.key}`} className="font-semibold text-teal-dark underline">
              {head.label}
            </Link>
            <form method="post" action={`/claims/${id}/invoice`}>
              <SubmitKeyInput />
              <input type="hidden" name="head" value={head.key} />
              <button type="submit" className="rounded-md border border-line bg-white px-3 py-1 text-sm text-navy">
                Draft invoice
              </button>
            </form>
          </li>
        ))}
      </ul>
      <form method="post" action={`/claims/${id}/invoice`}>
        <SubmitKeyInput />
        <input type="hidden" name="head" value="customer" />
        <button type="submit" className="rounded-md border border-line bg-white px-3 py-1 text-sm text-navy">
          Draft customer invoice – recovery and storage
        </button>
      </form>
    </div>
  );
}
