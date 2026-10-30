import Link from "next/link";
import {
  actionCreateStaff,
  actionResetStaffPassword,
  actionResetTwoStep,
  actionSetIdleMinutes,
  actionSetStaffActive,
  actionSetStaffRole,
} from "@/app/staff-actions";
import { PageHeader } from "@/components/ClaimTable";
import { RecordVersionField, SaveClashNotice } from "@/components/SaveClashNotice";
import { ValidatedForm } from "@/components/ValidatedForm";
import { requireAdministrator } from "@/lib/auth/session";
import { ADMINISTRATOR_ROLE, DRIVER_ROLE, MECHANIC_ROLE, STAFF_ROLE, roleLabel } from "@/lib/auth/roles";
import { listAllStaff } from "@/lib/db/staff-admin";
import { idleMinutes, LOCK_AFTER_FAILURES, LOCK_MINUTES, twoStepRequired } from "@/lib/auth/login-security";
import { loadClash, sectionVersion } from "@/lib/db/record-version";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export default async function StaffAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; clash?: string }>;
}) {
  await requireAdministrator();
  const { error, saved, clash } = await searchParams;
  const staffClash = loadClash(clash);
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

      <SaveClashNotice clash={staffClash?.scope === "staff" ? staffClash : null} reloadHref="/settings/staff" />
      {error ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p>
      ) : null}
      {saved ? (
        <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm text-ok">Saved.</p>
      ) : null}

      <section className="rounded-xl border border-line bg-card p-5" data-sign-in-security>
        <h2 className="font-serif text-xl text-navy-deep">Sign-in security</h2>
        <p className="mt-1 text-sm text-slate">
          After {LOCK_AFTER_FAILURES} failed attempts a username is locked for {LOCK_MINUTES} minutes; resetting the password unlocks it. New passwords need at least 12 characters using three of: lower case, capitals, numbers, symbols. Administrators must use an authenticator app; staff can switch one on in Settings.
        </p>
        <form action={actionSetIdleMinutes} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Sign out after this many minutes without use
            <input name="minutes" inputMode="numeric" defaultValue={idleMinutes()} className={field} />
          </label>
          <button type="submit" className="rounded-md border border-line px-3 py-2 text-sm">
            Save
          </button>
        </form>
      </section>

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
            <input name="password" type="password" required minLength={12} className={field} autoComplete="new-password" />
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
                <RecordVersionField
                  version={staffClash?.recordKey === person.id ? staffClash.expectedVersion : sectionVersion("staff", person.id)}
                />
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
                <RecordVersionField version={sectionVersion("staff", person.id)} />
                <label className="block text-sm">
                  Reset password
                  <input name="password" type="password" required minLength={12} className={field} autoComplete="new-password" />
                </label>
                <button type="submit" className="rounded-md border border-line px-3 py-2 text-sm">
                  Reset and sign them out
                </button>
              </ValidatedForm>
              <form action={actionResetTwoStep} className="space-y-2" data-two-step={person.totp_enabled_at ? "on" : "off"}>
                <input type="hidden" name="staffId" value={person.id} />
                <p className="text-sm text-slate">
                  Authenticator app: {person.totp_enabled_at ? "on" : twoStepRequired(person.role) ? "required, set up at next sign-in" : "off"}
                </p>
                {person.totp_enabled_at ? (
                  <button type="submit" className="rounded-md border border-line px-3 py-2 text-sm">
                    Reset (lost phone)
                  </button>
                ) : null}
              </form>
              <form action={actionSetStaffActive} className="space-y-2">
                <input type="hidden" name="staffId" value={person.id} />
                <RecordVersionField version={sectionVersion("staff", person.id)} />
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
