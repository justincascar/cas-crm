import Link from "next/link";
import { ClaimTable, PageHeader, SearchForm } from "@/components/ClaimTable";
import { formatGbp } from "@/lib/money";
import { requireStaff } from "@/lib/auth/session";
import { dbLocation, getDashboard } from "@/lib/db/queries";

const toneClass: Record<string, string> = {
  info: "border-l-teal",
  warn: "border-l-warn",
  bad: "border-l-overdue",
  ok: "border-l-ok",
};

export default async function DashboardPage() {
  await requireStaff();
  const data = getDashboard();
  const path = dbLocation();

  return (
    <div>
      <PageHeader
        title="Claims desk"
        subtitle="Counts open the matching list. Claimed, agreed and received are shown separately and are never added together."
        actions={<SearchForm action="/claims" />}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {data.cards.map((card) => (
          <Link
            key={card.key}
            href={card.href || `/claims?queue=${card.key}`}
            className={`rounded-xl border border-line border-l-4 bg-card p-4 shadow-[0_1px_0_rgba(16,28,36,0.04)] ${toneClass[card.tone] || "border-l-teal"}`}
          >
            <p className="text-xs uppercase tracking-[0.12em] text-slate">{card.label}</p>
            <p className="mt-2 font-serif text-4xl tabular text-navy-deep">{card.count}</p>
          </Link>
        ))}
      </section>

      <section className="mt-8 grid gap-6 xl:grid-cols-3">
        <div className="rounded-xl border border-line bg-card p-5 xl:col-span-2">
          <h2 className="font-serif text-xl text-navy-deep">Tasks by handler</h2>
          <p className="mb-4 text-sm text-slate">Due today and overdue only. Open tasks for the full list.</p>
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Handler</th>
                <th>Due today</th>
                <th>Overdue</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.byHandler).map(([name, counts]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td className="tabular">{counts.today}</td>
                  <td className="tabular text-overdue">{counts.overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rounded-xl border border-line bg-card p-5">
          <h2 className="font-serif text-xl text-navy-deep">Fleet snapshot</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>Available: <strong className="tabular">{data.fleetMap.available || 0}</strong></li>
            <li>Reserved: <strong className="tabular">{data.fleetMap.reserved || 0}</strong></li>
            <li>On hire / courtesy: <strong className="tabular">{data.fleetMap.on_hire || 0}</strong></li>
            <li>Maintenance: <strong className="tabular">{data.fleetMap.maintenance || 0}</strong></li>
          </ul>
          <p className="mt-4 text-xs text-slate">Reservation does not start charges. See Hire / Fleet.</p>
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Amounts by head of loss</h2>
        <p className="mb-4 text-sm text-slate">
          Claimed, offered, agreed and received are four different figures. An offer is not a payment.
        </p>
        <div className="overflow-x-auto">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Head</th>
                <th>Claimed</th>
                <th>Offered</th>
                <th>Agreed</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.byHead).map(([head, sums]) => (
                <tr key={head}>
                  <td>{data.headLabels[head] || head}</td>
                  <td className="tabular">{formatGbp(sums.claimed)}</td>
                  <td className="tabular">{formatGbp(sums.offered)}</td>
                  <td className="tabular">{formatGbp(sums.agreed)}</td>
                  <td className="tabular">{formatGbp(sums.received)}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Distinct totals</strong>
                </td>
                <td className="tabular">
                  <strong>{formatGbp(data.totals.claimed)}</strong>
                </td>
                <td className="tabular">
                  <strong>{formatGbp(data.totals.offered)}</strong>
                </td>
                <td className="tabular">
                  <strong>{formatGbp(data.totals.agreed)}</strong>
                </td>
                <td className="tabular">
                  <strong>{formatGbp(data.totals.received)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 font-serif text-xl text-navy-deep">All prototype files</h2>
        <ClaimTable rows={data.claims} />
      </section>

      <p className="mt-8 text-xs text-slate">
        Data is stored on this PC at <span className="ref">{path}</span> (kept off OneDrive to avoid file locking).
        Changes survive closing the browser.
      </p>
    </div>
  );
}
