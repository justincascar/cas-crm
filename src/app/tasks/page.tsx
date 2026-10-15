import { actionCompleteTask } from "@/app/actions";
import { asFormAction } from "@/lib/form-action";
import { PageHeader } from "@/components/ClaimTable";
import { dueTextClass, dueWording } from "@/lib/domain/due-wording";
import { requireStaff } from "@/lib/auth/session";
import { listTasks } from "@/lib/db/queries";
import Link from "next/link";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ when?: string; handler?: string }>;
}) {
  await requireStaff();
  const { when, handler } = await searchParams;
  const tasks = listTasks(when, handler || null);
  const href = (nextWhen?: string) => {
    const params = new URLSearchParams();
    if (nextWhen) params.set("when", nextWhen);
    if (handler) params.set("handler", handler);
    const query = params.toString();
    return query ? `/tasks?${query}` : "/tasks";
  };
  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle="Open work grouped for the claims desk. Completing a task persists on this PC."
      />
      <div className="mb-4 flex gap-3 text-sm">
        <Link href={href()} className={!when ? "font-semibold text-teal-dark" : "text-slate"}>
          All open
        </Link>
        <Link href={href("today")} className={when === "today" ? "font-semibold text-teal-dark" : "text-slate"}>
          Due today
        </Link>
        <Link href={href("overdue")} className={when === "overdue" ? "font-semibold text-teal-dark" : "text-slate"}>
          Overdue
        </Link>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Task</th>
              <th>File</th>
              <th>Handler</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={String(t.id)}>
                <td>
                  <TaskWhen value={t.due_at ? String(t.due_at) : null} />
                </td>
                <td>
                  {String(t.title)}
                  <div className="text-xs text-slate">{String(t.details || "")}</div>
                </td>
                <td>
                  {t.claim_id ? (
                    <Link className="ref text-teal-dark hover:underline" href={`/claims/${t.claim_id}`}>
                      {String(t.file_reference)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{String(t.handler_name || "Unassigned")}</td>
                <td>
                  <form action={asFormAction(actionCompleteTask)}>
                    <input type="hidden" name="taskId" value={String(t.id)} />
                    <button className="text-sm text-teal-dark underline" type="submit">
                      Done
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TaskWhen({ value }: { value: string | null }) {
  const when = dueWording(value);
  if (when.tone === "unknown") return <span>—</span>;
  return <span className={dueTextClass(when.tone)}>{when.text}</span>;
}
