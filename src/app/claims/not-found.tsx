import Link from "next/link";
import { SearchForm } from "@/components/ClaimTable";

export default function ClaimNotFound() {
  return (
    <div className="mx-auto max-w-xl space-y-4 rounded-xl border border-line bg-card p-6" data-claim-not-found>
      <h1 className="font-serif text-2xl text-navy-deep">Claim not found</h1>
      <p className="text-sm">There is no claim at this address. It may have been typed wrongly. Search by file reference, name or registration.</p>
      <SearchForm action="/claims" />
      <p className="text-sm">
        <Link href="/claims" className="text-teal-dark underline">
          All claims
        </Link>
        {" · "}
        <Link href="/" className="text-teal-dark underline">
          Claims desk
        </Link>
      </p>
    </div>
  );
}
