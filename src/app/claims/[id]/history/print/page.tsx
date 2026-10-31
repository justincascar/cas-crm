import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { requireStaff } from "@/lib/auth/session";
import { formatUkDate } from "@/lib/dates";
import { listClaimEvents } from "@/lib/db/chronology";
import { getClaim } from "@/lib/db/queries";
import { printChronology } from "@/lib/domain/print-chronology";
import { HeadedPaper } from "@/components/HeadedPaper";
import { getCompanyDetails } from "@/lib/db/company-details";

export default async function ClaimChronologyPrintPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  const data = getClaim(id);
  if (!data) notFound();
  const claim = data.claim;
  const lines = printChronology(listClaimEvents(String(claim.id)));

  return (
    <article className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h2 className="font-serif text-xl text-navy-deep">Chronology</h2>
        <PrintButton label="Print / save chronology" />
      </div>
      <HeadedPaper company={getCompanyDetails()}>
      <h1 className="font-serif text-xl text-navy-deep">Chronology</h1>
      <header>
        <p className="font-mono text-sm text-teal-dark">{String(claim.file_reference || "")}</p>
        <p className="text-sm">
          {String(claim.client_name || "")}
          {claim.registration ? ` · ${String(claim.registration)}` : ""}
        </p>
        <p className="text-sm text-slate">Printed {formatUkDate(new Date().toISOString())}</p>
      </header>
      {lines.length === 0 ? (
        <p className="text-sm">No steps or messages are on this file.</p>
      ) : (
        <ol className="space-y-2">
          {lines.map((line) => (
            <li key={line.id} className="text-sm">
              <span className="font-semibold">{line.date}</span>
              {" — "}
              {line.text}
            </li>
          ))}
        </ol>
      )}
      </HeadedPaper>
    </article>
  );
}
