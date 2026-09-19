import {
  actionRecordEvent,
} from "@/app/actions";
import { DocumentGenerateForm } from "@/components/DocumentGenerateForm";
import { ValidatedForm } from "@/components/ValidatedForm";
import { CLAIM_EVENT_TYPES } from "@/lib/domain/events";
import { formatUkDate, formatUkDateTime } from "@/lib/dates";
import Link from "next/link";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

type EventRow = {
  id: string;
  event_type: string;
  title: string;
  details: string | null;
  occurred_at: string;
  actor_name: string | null;
  channel: string | null;
  document_id: string | null;
};

type KeyDate = { type: string; label: string; at: string | null };

export function FileHistory({
  claimId,
  handlerId,
  events,
  keyDates,
  correspondence,
  documents,
  liabilityStatus,
}: {
  claimId: string;
  handlerId: string;
  events: EventRow[];
  keyDates: KeyDate[];
  correspondence: Array<Record<string, string | number | null>>;
  documents: Array<Record<string, string | number | null>>;
  liabilityStatus: string;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-line bg-card p-5">
      <div>
        <h2 className="font-serif text-2xl text-navy-deep">File history</h2>
        <p className="text-sm text-slate">
          Dated steps on this file — when the initial letter went, when the engineer was instructed, when repairs started, and so on.
          Letters and emails are built from these dates. Email is logged here. Instruct Engineer is prepared, not auto-sent; live sending from claims@cascar.co.uk is not connected yet.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {keyDates.map((item) => (
          <div key={item.type} className="rounded-lg border border-line bg-paper px-3 py-2">
            <p className="text-[11px] uppercase tracking-[0.12em] text-slate">{item.label}</p>
            <p className="tabular text-sm">{item.at ? formatUkDate(item.at) : "Not recorded"}</p>
          </div>
        ))}
      </div>

      <ol className="space-y-3 border-l-2 border-line pl-4">
        {events.length === 0 ? <p className="text-sm text-slate">No history recorded yet.</p> : null}
        {events.map((event) => (
          <li key={event.id}>
            <p className="text-xs text-slate">
              {formatUkDateTime(event.occurred_at)}
              {event.actor_name ? ` · ${event.actor_name}` : ""}
              {event.channel ? ` · ${event.channel}` : ""}
            </p>
            <p className="text-sm">
              <strong>{event.title}</strong>
              {event.details ? ` — ${event.details}` : ""}
            </p>
            {event.document_id ? (
              <Link className="text-xs text-teal-dark underline" href={`/documents/${event.document_id}`}>
                Open generated document
              </Link>
            ) : null}
          </li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-3">
        <ValidatedForm action={actionRecordEvent} className="space-y-2 rounded-lg border border-line p-4">
          <h3 className="font-serif text-lg text-navy-deep">Record a dated step</h3>
          <input type="hidden" name="claimId" value={claimId} />
          <input type="hidden" name="actorId" value={handlerId} />
          <label className="block text-sm">
            What happened
            <select name="eventType" className={field} defaultValue="initial_letter_tp_insurer">
              {CLAIM_EVENT_TYPES.filter((t) => t.key !== "document_generated").map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Date it happened
            <input name="occurredAt" type="datetime-local" required className={field} />
          </label>
          <label className="block text-sm">
            Channel
            <select name="channel" className={field} defaultValue="letter">
              <option value="letter">Letter</option>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="phone">Telephone</option>
              <option value="system">Internal / system</option>
            </select>
          </label>
          <label className="block text-sm">
            Details
            <input name="details" className={field} placeholder="Optional note" />
          </label>
          <button className="rounded-md bg-navy px-3 py-2 text-sm text-white" type="submit">
            Save on file history
          </button>
        </ValidatedForm>

        <DocumentGenerateForm
          claimId={claimId}
          handlerId={handlerId}
          liabilityStatus={liabilityStatus}
          variant="history"
        />

        <div className="space-y-2 rounded-lg border-2 border-navy bg-[#e8eef4] p-4">
          <h3 className="font-serif text-lg text-navy-deep">Email, WhatsApp and calls</h3>
          <p className="text-xs text-slate">
            Send and file email and WhatsApp, record calls made and received, and generate letters from this file.
          </p>
          <Link href={`/claims/${claimId}/work/comms`} className="inline-block rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
            Open communications
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="font-serif text-lg text-navy-deep">Letters on this file</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {documents.map((d) => (
              <li key={String(d.id)}>
                {d.body_html ? (
                  <Link className="text-teal-dark underline" href={`/documents/${d.id}`}>
                    {String(d.title)} v{String(d.version)}
                  </Link>
                ) : (
                  <span>
                    {String(d.title)} v{String(d.version)} (placeholder)
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-serif text-lg text-navy-deep">Correspondence on this file</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {correspondence.map((c) => (
              <li key={String(c.id)}>
                {formatUkDateTime(String(c.created_at))} · {String(c.direction)} {String(c.channel)} · {String(c.subject)} ({String(c.sent_status)})
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
