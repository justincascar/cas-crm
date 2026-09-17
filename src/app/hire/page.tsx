import Link from "next/link";
import { PageHeader } from "@/components/ClaimTable";
import { ReserveForm } from "@/components/ReserveForm";
import { formatUkDateTime } from "@/lib/dates";
import { requireStaff } from "@/lib/auth/session";
import { listClaims, listFleet, listReservations } from "@/lib/db/queries";

export default async function HirePage() {
  await requireStaff();
  const fleet = listFleet();
  const reservations = listReservations();
  const claims = listClaims();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Hire / Fleet"
        subtitle="Availability, reservations and active use. Courtesy on a fault file is not credit hire."
      />
      <section className="rounded-xl border-2 border-teal bg-[#e8f4f2] p-5">
        <h2 className="font-serif text-xl text-navy-deep">Hire Packs</h2>
        <p className="mt-1 text-sm text-slate">
          The client hire pack (delivery, damage, mitigation, agreement and collection) is generated from the claim file, not from the fleet list.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Client</th>
                <th>Position</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id}>
                  <td className="ref">{c.file_reference}</td>
                  <td>{c.client_name || "Unknown"}</td>
                  <td>{c.current_position}</td>
                  <td>
                    <Link href={`/claims/${c.id}/hire-pack`} className="inline-block rounded-md bg-teal px-3 py-1.5 text-xs font-semibold text-white">
                      Hire Pack
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Spec</th>
              <th>Status</th>
              <th>Location</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {fleet.map((v) => (
              <tr key={String(v.id)}>
                <td className="ref">{String(v.registration)}</td>
                <td>
                  {String(v.make)} {String(v.model)} · {String(v.transmission)} · {String(v.seats)} seats
                </td>
                <td>{String(v.status).replaceAll("_", " ")}</td>
                <td>{String(v.location || "")}</td>
                <td>{String(v.notes || "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>File</th>
              <th>Kind</th>
              <th>Start</th>
              <th>End</th>
              <th>Charges started</th>
            </tr>
          </thead>
          <tbody>
            {reservations.map((r) => (
              <tr key={String(r.id)}>
                <td className="ref">{String(r.registration)}</td>
                <td>{String(r.file_reference || "—")}</td>
                <td>{String(r.kind)}</td>
                <td>{formatUkDateTime(String(r.start_at))}</td>
                <td>{formatUkDateTime(String(r.end_at))}</td>
                <td>{Number(r.charges_started) ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ReserveForm
        vehicles={fleet.map((v) => ({
          id: String(v.id),
          label: `${v.registration} — ${v.make} ${v.model} (${v.status})`,
        }))}
        claims={claims.map((c) => ({ id: c.id, label: `${c.file_reference} ${c.client_name || ""}` }))}
      />
    </div>
  );
}
