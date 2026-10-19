import Link from "next/link";

const HEADS = [
  { key: "recovery", label: "Recovery" },
  { key: "storage", label: "Storage" },
  { key: "hire", label: "Hire" },
  { key: "vehicle", label: "Vehicle damage" },
] as const;

export default async function ClaimMoneyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="space-y-3">
      <h2 className="font-serif text-xl text-navy-deep">Money</h2>
      <ul className="space-y-2">
        {HEADS.map((head) => (
          <li key={head.key}>
            <Link href={`/claims/${id}/money/${head.key}`} className="font-semibold text-teal-dark underline">
              {head.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
