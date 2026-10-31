import { notFound, redirect } from "next/navigation";
import { HireJourney } from "@/components/claims/HireJourney";
import { canDoFieldJob, isOfficeRole } from "@/lib/auth/roles";
import { requireStaff } from "@/lib/auth/session";
import { loadHireArea } from "@/lib/db/hire-choice";
import { accountCanOverridePreHireChecks } from "@/lib/db/permissions";
import { loadClash } from "@/lib/db/record-version";
import { listStaff } from "@/lib/db/queries";
import { canOverrideUnsignedSwap, swapView } from "@/lib/db/vehicle-swap";
import { londonTodayIso } from "@/lib/dates";
import { get } from "@/lib/db/connection";

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
  if (!isOfficeRole(staff.role)) redirect("/jobs?notice=office");
  // A filter missing from the address uses the client's own car. A blank one means any.
  const area = loadHireArea(id, {
    date: query.date,
    transmission: query.transmission,
    vehicleClass: query.class,
    seats: query.seats,
  });
  if (!area) notFound();
  const handlers = listStaff()
    .filter((person) => canDoFieldJob(person.role))
    .map((person) => ({ id: String(person.id), name: String(person.name) }));
  // R64: on a Split file Justin decides per file whether credit hire continues.
  const liability = get<{ claim_type: string | null; split_tp_percent: number | null }>(`SELECT claim_type, split_tp_percent FROM claims WHERE id = ?`, [id]);
  const split = liability?.claim_type === "split";
  return (
    <>
      {split ? (
        <p className="mb-4 rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm font-semibold text-overdue" role="alert" data-split-warning>
          Split liability – check with Justin before continuing credit hire.
          {liability?.split_tp_percent != null ? ` Third party ${liability.split_tp_percent}%, client ${100 - liability.split_tp_percent}%.` : ""}
        </p>
      ) : null}
    <HireJourney
      area={area}
      error={query.error}
      saved={query.saved}
      clash={loadClash(query.clash)}
      handlers={handlers}
      mayOverride={accountCanOverridePreHireChecks(staff.id, staff.role)}
      showPack={query.pack === "all"}
      swap={swapView(id, londonTodayIso())}
      mayOverrideSwap={canOverrideUnsignedSwap(staff.id)}
      swapCar={query.swapCar}
      carFromFleet={query.car}
    />
    </>
  );
}
