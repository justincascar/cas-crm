import Link from "next/link";
import { ClaimTable, PageHeader, SearchForm } from "@/components/ClaimTable";
import { listClaims, QUEUE_LABELS } from "@/lib/db/queries";

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; queue?: string }>;
}) {
  const sp = await searchParams;
  const rows = listClaims({ q: sp.q, queue: sp.queue });
  const queueLabel = sp.queue ? QUEUE_LABELS[sp.queue] : null;

  return (
    <div>
      <PageHeader
        title="Claims"
        subtitle={queueLabel ? `Filtered: ${queueLabel}` : "Search by reference, client, registration or insurer reference."}
        actions={
          <Link href="/claims/new" className="rounded-md bg-teal px-4 py-2 text-sm text-white">
            New claim
          </Link>
        }
      />
      <div className="mb-5">
        <SearchForm defaultQuery={sp.q} />
      </div>
      {sp.queue ? (
        <p className="mb-4 text-sm">
          <Link href="/claims" className="text-teal-dark underline">
            Clear filter
          </Link>
        </p>
      ) : null}
      <ClaimTable rows={rows} />
    </div>
  );
}
