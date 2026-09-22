import Link from "next/link";
import {
  actionCreateStaff,
  actionResetStaffPassword,
  actionSetStaffActive,
  actionSetStaffRole,
} from "@/app/staff-actions";
import { PageHeader } from "@/components/ClaimTable";
import { ValidatedForm } from "@/components/ValidatedForm";
import { requireAdministrator } from "@/lib/auth/session";
import { ADMINISTRATOR_ROLE, DRIVER_ROLE, MECHANIC_ROLE, STAFF_ROLE, roleLabel } from "@/lib/auth/roles";
import { listAllStaff } from "@/lib/db/staff-admin";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export default async function StaffAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireAdministrator();
  const { error, saved } = await searchParams;
  const staff = listAllStaff();

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Staff logins"
        subtitle="Administrators can create, disable, reset passwords and change roles. Administrator and staff can open every file. Driver and bodyshop / mechanic can open only the jobs assigned to them today."
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
        <h2 className="font-serif text-xl text-navy-deep">Add a staff login</h2>
        <ValidatedForm action={actionCreateStaff} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Name
            <input name="name" required className={field} />
          </label>
          <label className="text-sm">
            Username
            <input name="username" required className={field} autoComplete="off" />
          </label>
          <label className="text-sm">
            Email
            <input name="email" type="email" required className={field} />
          </label>
          <label className="text-sm">
            Temporary password
            <input name="password" type="password" required minLength={8} className={field} autoComplete="new-password" />
          </label>
          <label className="text-sm">
            Role
            <select name="role" className={field} defaultValue={STAFF_ROLE}>
              <option value={STAFF_ROLE}>Staff</option>
              <option value={ADMINISTRATOR_ROLE}>Administrator</option>
              <option value={DRIVER_ROLE}>Driver</option>
              <option value={MECHANIC_ROLE}>Bodyshop / mechanic</option>
            </select>
          </label>
          <div className="flex items-end">
            <button type="submit" className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white">
              Create login
            </button>
          </div>
        </ValidatedForm>
      </section>

      <section className="space-y-3">
        {staff.map((person) => (
          <article key={person.id} className="rounded-xl border border-line bg-card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-serif text-lg text-navy-deep">{person.name}</h2>
              <p className="text-sm text-slate">
                {person.active ? "Active" : "Disabled"} · {roleLabel(person.role)} · {person.username}
              </p>
            </div>
            <p className="mt-1 text-sm text-slate">{person.email}</p>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <form action={actionSetStaffRole} className="space-y-2">
                <input type="hidden" name="staffId" value={person.id} />
                <label className="block text-sm">
                  Role
                  <select name="role" className={field} defaultValue={person.role}>
                    <option value={STAFF_ROLE}>Staff</option>
                    <option value={ADMINISTRATOR_ROLE}>Administrator</option>
                    <option value={DRIVER_ROLE}>Driver</option>
                    <option value={MECHANIC_ROLE}>Bodyshop / mechanic</option>
                  </select>
                </label>
                <button type="submit" className="rounded-md border border-line px-3 py-2 text-sm">
                  Save role
                </button>
              </form>
              <ValidatedForm action={actionResetStaffPassword} className="space-y-2">
                <input type="hidden" name="staffId" value={person.id} />
                <label className="block text-sm">
                  Reset password
                  <input name="password" type="password" required minLength={8} className={field} autoComplete="new-password" />
                </label>
                <button type="submit" className="rounded-md border border-line px-3 py-2 text-sm">
                  Reset and sign them out
                </button>
              </ValidatedForm>
              <form action={actionSetStaffActive} className="space-y-2">
                <input type="hidden" name="staffId" value={person.id} />
                <input type="hidden" name="active" value={person.active ? "0" : "1"} />
                <p className="text-sm text-slate">
                  {person.active
                    ? "Disable this login. They will be signed out immediately."
                    : "This login is disabled."}
                </p>
                <button type="submit" className="rounded-md border border-line px-3 py-2 text-sm">
                  {person.active ? "Disable login" : "Enable login"}
                </button>
              </form>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
