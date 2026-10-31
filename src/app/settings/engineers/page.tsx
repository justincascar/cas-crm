import Link from "next/link";
import {
  actionCreateEngineer,
  actionSetEngineerActive,
  actionUpdateEngineer,
} from "@/app/engineer-actions";
import { PageHeader } from "@/components/ClaimTable";
import { RecordVersionField, SaveClashNotice } from "@/components/SaveClashNotice";
import { ValidatedForm } from "@/components/ValidatedForm";
import { requireStaff } from "@/lib/auth/session";
import { listAllEngineers } from "@/lib/db/engineers";
import { all } from "@/lib/db/connection";
import { defaultEngineerFor, engineerDispatchSettings, instructionContent } from "@/lib/db/engineer-dispatch";
import { listStaff } from "@/lib/db/queries";
import { loadClash, sectionVersion } from "@/lib/db/record-version";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export default async function EngineersAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; clash?: string }>;
}) {
  await requireStaff();
  const { error, saved, clash } = await searchParams;
  const engineerClash = loadClash(clash);
  const engineers = listAllEngineers();
  // R65: the instruction step's defaults, and its wording on a TEST file for Justin to read.
  const dispatch = engineerDispatchSettings();
  const staffList = listStaff().filter((person) => person.role !== "driver" && person.role !== "mechanic");
  const example = all<{ id: string; file_reference: string }>(
    `SELECT id, file_reference FROM claims WHERE file_reference LIKE 'TEST-%' AND COALESCE(claim_type, '') <> 'fault' ORDER BY file_reference LIMIT 1`,
  )[0];
  let exampleWording: { reference: string; subject: string; body: string } | null = null;
  if (example) {
    try {
      const content = instructionContent(String(example.id), defaultEngineerFor(String(example.id)));
      exampleWording = { reference: String(example.file_reference), subject: content.subject, body: content.body };
    } catch {
      exampleWording = null;
    }
  }

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

      <section id="instructions" className="scroll-mt-20 rounded-xl border border-line bg-card p-5" data-engineer-dispatch>
        <h2 className="font-serif text-xl text-navy-deep">Instructions from step 5</h2>
        <p className="mt-1 text-sm text-slate">
          The default engineer is used on live files; TEST files always use the fictional engineer. The file&apos;s handler is always copied in; add any
          other addresses (for example a shared claims mailbox) below.
        </p>
        <form method="post" action="/settings/engineers/dispatch" className="mt-4 grid gap-3">
          <label className="text-sm">
            Default engineer
            <select name="defaultEngineerId" defaultValue={dispatch.defaultEngineerId} className={field}>
              <option value="">None (the fictional engineer on TEST files)</option>
              {engineers
                .filter((engineer) => engineer.active === 1)
                .map((engineer) => (
                  <option key={engineer.id} value={engineer.id}>
                    {engineer.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm">
            Also copy instructions to (email addresses, separated by commas)
            <input name="extraCc" defaultValue={dispatch.extraCc.join(", ")} className={field} placeholder="Leave blank: only the handler is copied in" />
          </label>
          <label className="text-sm">
            Audatex estimator
            <select name="estimatorId" defaultValue={dispatch.estimatorId} className={field}>
              <option value="">The file&apos;s handler (until question 32 is answered)</option>
              {staffList.map((person) => (
                <option key={String(person.id)} value={String(person.id)}>
                  {String(person.name)}
                </option>
              ))}
            </select>
          </label>
          <div>
            <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
              Save
            </button>
          </div>
        </form>
        <details className="mt-4 rounded-md border border-line bg-white px-3 py-2 text-sm" data-instruction-wording>
          <summary className="cursor-pointer font-semibold">Read the wording</summary>
          {exampleWording ? (
            <>
              <p className="mt-2 text-xs text-slate">
                Example on {exampleWording.reference}, made by the same code that sends it. Nothing was filed or sent. The supplied engineer instruction
                is unchanged; the &ldquo;From the claim file&rdquo; lines are added because the template has no place for them.
              </p>
              <p className="mt-2">
                <span className="font-semibold">Subject:</span> {exampleWording.subject}
              </p>
              <pre className="mt-2 whitespace-pre-wrap break-words font-sans">{exampleWording.body}</pre>
            </>
          ) : (
            <p className="mt-2 text-slate">No TEST file to show it on.</p>
          )}
        </details>
      </section>

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
            <SaveClashNotice
              clash={engineerClash?.scope === "engineer" && engineerClash.recordKey === engineer.id ? engineerClash : null}
              reloadHref="/settings/engineers"
            />
            <ValidatedForm action={actionUpdateEngineer} className="grid gap-3">
              <input type="hidden" name="engineerId" value={engineer.id} />
              <RecordVersionField
                version={
                  engineerClash?.scope === "engineer" && engineerClash.recordKey === engineer.id
                    ? engineerClash.expectedVersion
                    : sectionVersion("engineer", engineer.id)
                }
              />
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
              <RecordVersionField version={sectionVersion("engineer", engineer.id)} />
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
