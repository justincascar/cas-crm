import Link from "next/link";
import { PageHeader } from "@/components/ClaimTable";
import { ROLE_ACCESS, ROLE_CAN_DO, permissionWords } from "@/lib/auth/role-access";
import { STAFF_ACCESS_ROLES, roleLabel } from "@/lib/auth/roles";
import { requireStaff } from "@/lib/auth/session";
import { all } from "@/lib/db/connection";

/** Who can see and do what, by role, and the extra permissions each person holds (J12). */
export default async function RolesPage() {
  await requireStaff();
  const people = all<{ name: string; role: string; permissions: string | null }>(
    `SELECT s.name, s.role, GROUP_CONCAT(p.permission, ', ') AS permissions
     FROM staff s LEFT JOIN staff_permissions p ON p.staff_id = s.id
     WHERE s.active = 1 GROUP BY s.id ORDER BY s.name`,
  );
  return (
    <div className="space-y-6">
      <PageHeader title="Who can do what" subtitle="By role, checked on the server for every page and file, not only hidden from the menu." />
      <p className="text-sm">
        <Link href="/settings" className="text-teal-dark underline">
          Back to Settings
        </Link>
      </p>
      <section className="grid gap-4 md:grid-cols-2">
        {STAFF_ACCESS_ROLES.map((role) => (
          <div key={role} className="rounded-xl border border-line bg-card p-4">
            <h2 className="font-serif text-lg text-navy-deep">{role === "administrator" ? "Justin (administrator)" : roleLabel(role)}</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {ROLE_CAN_DO[role].map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>
      <section className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="w-full text-sm" data-role-table>
          <thead>
            <tr className="text-left text-slate">
              <th className="px-3 py-2">Page or file</th>
              {STAFF_ACCESS_ROLES.map((role) => (
                <th key={role} className="px-3 py-2">
                  {role === "administrator" ? "Justin" : roleLabel(role)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLE_ACCESS.map((area) => (
              <tr key={area.key} className="border-t border-line">
                <td className="px-3 py-2">{area.label}</td>
                {STAFF_ACCESS_ROLES.map((role) => (
                  <td key={role} className="px-3 py-2">
                    {area.open[role] ? (area.justinOnly ? "Yes (Justin's permission)" : "Yes") : "No"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="rounded-xl border border-line bg-card p-4">
        <h2 className="font-serif text-lg text-navy-deep">Extra permissions held by each person</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {people.map((person) => (
            <li key={person.name}>
              <span className="font-semibold">{person.name}</span> ({roleLabel(person.role)}): {permissionWords(person.permissions)}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate">Proved by scripts/permissions-check.ts, which signs in as each role and opens each address directly.</p>
      </section>
    </div>
  );
}
