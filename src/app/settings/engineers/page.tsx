import Link from "next/link";
import {
  actionCreateEngineer,
  actionSetEngineerActive,
  actionUpdateEngineer,
} from "@/app/engineer-actions";
import { PageHeader } from "@/components/ClaimTable";
import { ValidatedForm } from "@/components/ValidatedForm";
import { requireStaff } from "@/lib/auth/session";
import { listAllEngineers } from "@/lib/db/engineers";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export default async function EngineersAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireStaff();
  const { error, saved } = await searchParams;
  const engineers = listAllEngineers();

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Engineers"
        subtitle="Saved engineers for instruction letters. Staff pick from this list rather than typing name and address each time."
        actions={
          <Link href="/settings" className="text-sm text-teal-dark underline">
            Back to settings
          </Link>
        }
      />

      {error ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p>
      ) : null}
      {saved ? (
        <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm text-ok">Saved.</p>
      ) : null}

      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Add an engineer</h2>
        <ValidatedForm action={actionCreateEngineer} className="mt-4 grid gap-3">
          <label className="text-sm">
            Name
            <input name="name" required className={field} placeholder="Name, firm" />
          </label>
          <label className="text-sm">
            Address
            <textarea name="address" required rows={3} className={field} />
          </label>
          <label className="text-sm">
            Email
            <input name="email" type="email" required className={field} />
          </label>
          <div>
            <button type="submit" className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white">
              Add engineer
            </button>
          </div>
        </ValidatedForm>
      </section>

      <section className="space-y-3">
        {engineers.map((engineer) => (
          <article key={engineer.id} className="rounded-xl border border-line bg-card p-5">
            <ValidatedForm action={actionUpdateEngineer} className="grid gap-3">
              <input type="hidden" name="engineerId" value={engineer.id} />
              <label className="text-sm">
                Name
                <input name="name" required className={field} defaultValue={engineer.name} />
              </label>
              <label className="text-sm">
                Address
                <textarea name="address" required rows={3} className={field} defaultValue={engineer.address} />
              </label>
              <label className="text-sm">
                Email
                <input name="email" type="email" required className={field} defaultValue={engineer.email} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
                  Save
                </button>
              </div>
            </ValidatedForm>
            <ValidatedForm action={actionSetEngineerActive} className="mt-3">
              <input type="hidden" name="engineerId" value={engineer.id} />
              <input type="hidden" name="active" value={engineer.active ? "0" : "1"} />
              <button type="submit" className="text-sm text-teal-dark underline">
                {engineer.active ? "Remove from the dropdown" : "Show in the dropdown again"}
              </button>
              {!engineer.active ? <span className="ml-2 text-xs text-slate">Hidden from the instruction list</span> : null}
            </ValidatedForm>
          </article>
        ))}
      </section>
    </div>
  );
}
