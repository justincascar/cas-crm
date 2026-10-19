import Link from "next/link";
import { FinancialCircumstancesScreen } from "../financial/page";
import { HandoverScreen } from "../handover/page";
import { HirePackScreen } from "../hire-pack/page";
import { HireHeadScreen } from "../heads/hire/page";
import { PrehireChecksScreen } from "../prehire/page";

const SECTIONS = [
  { key: "checks", label: "Pre-hire checks" },
  { key: "pack", label: "Hire pack" },
  { key: "handover", label: "Handover" },
  { key: "money", label: "Hire money" },
  { key: "financial", label: "Financial circumstances" },
] as const;

type HireSection = (typeof SECTIONS)[number]["key"];

export default async function ClaimHirePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const section = (query.section || "") as HireSection | "";
  const known = SECTIONS.some((item) => item.key === section);

  return (
    <div className="space-y-4">
      <nav aria-label="Hire sections" className="flex flex-wrap gap-2 print:hidden">
        {SECTIONS.map((item) => (
          <Link
            key={item.key}
            href={`/claims/${id}/hire?section=${item.key}`}
            className={`rounded-md px-3 py-2 text-sm font-semibold ${
              section === item.key ? "bg-navy text-white" : "border border-line bg-white text-navy"
            }`}
            aria-current={section === item.key ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {section === "checks" ? (
        <PrehireChecksScreen params={Promise.resolve({ id })} searchParams={Promise.resolve(query) as Parameters<typeof PrehireChecksScreen>[0]["searchParams"]} />
      ) : null}
      {section === "pack" ? (
        <HirePackScreen params={Promise.resolve({ id })} searchParams={Promise.resolve(query) as Parameters<typeof HirePackScreen>[0]["searchParams"]} />
      ) : null}
      {section === "handover" ? (
        <HandoverScreen params={Promise.resolve({ id })} searchParams={Promise.resolve(query) as Parameters<typeof HandoverScreen>[0]["searchParams"]} />
      ) : null}
      {section === "money" ? (
        <HireHeadScreen params={Promise.resolve({ id })} searchParams={Promise.resolve(query) as Parameters<typeof HireHeadScreen>[0]["searchParams"]} />
      ) : null}
      {section === "financial" ? (
        <FinancialCircumstancesScreen params={Promise.resolve({ id })} searchParams={Promise.resolve(query) as Parameters<typeof FinancialCircumstancesScreen>[0]["searchParams"]} />
      ) : null}
      {!known ? <p className="text-sm text-slate">Choose pre-hire checks, the hire pack, handover, or hire money.</p> : null}
    </div>
  );
}
