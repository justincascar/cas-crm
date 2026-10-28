import { notFound, redirect } from "next/navigation";
import { HireJourney } from "@/components/claims/HireJourney";
import { canDoFieldJob, isOfficeRole } from "@/lib/auth/roles";
import { requireStaff } from "@/lib/auth/session";
import { loadHireArea } from "@/lib/db/hire-choice";
import { loadClash } from "@/lib/db/record-version";
import { listStaff } from "@/lib/db/queries";
import { londonTodayIso } from "@/lib/dates";

export default async function ClaimHirePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  if (query.section === "money") redirect(`/claims/${id}/money/hire`);
  if (query.section === "financial") redirect(`/claims/${id}/financial`);
  if (query.section === "checks" || query.section === "pack" || query.section === "handover") {
    redirect(`/claims/${id}/hire#${query.section}`);
  }
  const staff = await requireStaff();
  if (!isOfficeRole(staff.role)) redirect("/jobs");
  const filters = {
    date: query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : londonTodayIso(),
    transmission: query.transmission || "",
    vehicleClass: query.class || "",
    seats: query.seats || "",
  };
  const area = loadHireArea(id, filters);
  if (!area) notFound();
  const handlers = listStaff()
    .filter((person) => canDoFieldJob(person.role))
    .map((person) => ({ id: String(person.id), name: String(person.name) }));
  return (
    <HireJourney
      area={area}
      error={query.error}
      saved={query.saved}
      clash={loadClash(query.clash)}
      handlers={handlers}
      filters={filters}
    />
  );
}
