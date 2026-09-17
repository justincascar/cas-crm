import { PageHeader } from "@/components/ClaimTable";
import { dbLocation, getSettings, listStaff } from "@/lib/db/queries";
import { INDICATIVE_DEFAULTS } from "@/lib/constants";
import { formatGbp } from "@/lib/money";

export default function SettingsPage() {
  const settings = getSettings();
  const staff = listStaff();
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Prototype configuration. Staff sign-in is Stage 2. This screen shows what is already stored."
      />
      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Environment</h2>
        <dl className="mt-3 grid gap-2 text-sm">
          <Row label="Status" value={settings.environment || "prototype"} />
          <Row label="File prefix" value={settings.file_prefix} />
          <Row label="Agreement maximum days" value={settings.agreement_max_days} />
          <Row label="Renewal alert day" value={settings.agreement_renewal_alert_day} />
          <Row label="Chaser interval" value={`${settings.chaser_interval_days} ${settings.chaser_interval_unit} (demonstration setting)`} />
          <Row label="Database file" value={dbLocation()} />
        </dl>
      </section>
      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Indicative charge defaults</h2>
        <p className="mt-1 text-sm text-slate">Not applied automatically. Ranges require an actual chosen rate.</p>
        <ul className="mt-3 space-y-1 text-sm">
          <li>Storage {formatGbp(INDICATIVE_DEFAULTS.storage_per_day_net_pence)}/day + VAT</li>
          <li>Recovery {formatGbp(INDICATIVE_DEFAULTS.recovery_net_pence)} + VAT</li>
          <li>Gate fee {formatGbp(INDICATIVE_DEFAULTS.gate_fee_net_pence)} + VAT</li>
          <li>
            CDW {formatGbp(INDICATIVE_DEFAULTS.cdw_per_day_net_pence_range[0])}–
            {formatGbp(INDICATIVE_DEFAULTS.cdw_per_day_net_pence_range[1])}/day + VAT
          </li>
          <li>Delivery/collection {formatGbp(INDICATIVE_DEFAULTS.delivery_collection_net_pence)} + VAT</li>
        </ul>
      </section>
      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Staff (not yet authenticated)</h2>
        <ul className="mt-3 space-y-1 text-sm">
          {staff.map((s) => (
            <li key={s.id}>
              {s.name} — {s.role} — {s.email}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[12rem_1fr] gap-3">
      <dt className="text-slate">{label}</dt>
      <dd className="ref">{value}</dd>
    </div>
  );
}
