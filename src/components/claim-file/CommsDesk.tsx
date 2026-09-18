"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  actionGenerateDocument,
  actionLogIncomingEmail,
  actionLogIncomingWhatsApp,
  actionPreviewCorrespondence,
  actionRecordCall,
  actionSendEmail,
  actionSendWhatsApp,
} from "@/app/actions";
import { DOCUMENT_TEMPLATES } from "@/lib/documents/catalog";
import { EMAIL_TEMPLATES } from "@/lib/documents/email-templates";
import { formatUkDateTime } from "@/lib/dates";
import Link from "next/link";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export type CommsContactDefaults = {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  tpInsurer: string;
  tpEmail: string;
  tpPhone: string;
  fileReference: string;
  policyRef: string;
};

type CorrespondenceRow = Record<string, string | number | null>;
type DocumentRow = Record<string, string | number | null>;

export function CommsDesk({
  claimId,
  handlerId,
  defaults,
  correspondence,
  documents,
}: {
  claimId: string;
  handlerId: string;
  defaults: CommsContactDefaults;
  correspondence: CorrespondenceRow[];
  documents: DocumentRow[];
}) {
  const router = useRouter();
  const defaultSubject = `Our ref: ${defaults.fileReference}  Your policy: ${defaults.policyRef || "…"}`;
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [emailTo, setEmailTo] = useState(defaults.tpEmail);
  const [emailSubject, setEmailSubject] = useState(defaultSubject);
  const [emailBody, setEmailBody] = useState("Dear Sir / Madam\n\n");
  const [emailTemplate, setEmailTemplate] = useState<string>(EMAIL_TEMPLATES[0].key);
  const [fillMsg, setFillMsg] = useState<string | null>(null);
  const [waMsg, setWaMsg] = useState<string | null>(null);
  const [callMsg, setCallMsg] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">
        Email, WhatsApp and calls are recorded on this file. They do not leave this computer until CAS's mailbox, WhatsApp Business account and telephone system are connected. A click is not proof of delivery.
      </p>

      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">On this file</h2>
        {correspondence.length === 0 ? (
          <p className="mt-2 text-sm text-slate">Nothing filed yet.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {correspondence.map((row) => (
              <li key={String(row.id)} className="border-b border-line pb-2">
                <span className="text-xs text-slate">{formatUkDateTime(String(row.created_at))}</span>
                {" · "}
                <strong>
                  {String(row.direction)} {String(row.channel)}
                </strong>
                {" — "}
                {String(row.subject)}
                <div className="text-xs text-slate">{String(row.preview || "")}</div>
                <div className="text-xs text-slate">{String(row.sent_status)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form
        className="grid gap-3 rounded-xl border border-line bg-card p-5 md:grid-cols-2"
        action={async (formData) => {
          const result = await actionSendEmail(formData);
          setEmailMsg(result.ok ? result.warning : result.error);
          router.refresh();
        }}
      >
        <h2 className="font-serif text-xl text-navy-deep md:col-span-2">Send email</h2>
        <p className="text-sm text-slate md:col-span-2">
          Pick a CAS email template to fill from this file, then record the simulated send. Nothing leaves this computer.
        </p>
        <input type="hidden" name="claimId" value={claimId} />
        <input type="hidden" name="actorId" value={handlerId} />
        <input type="hidden" name="templateKey" value={emailTemplate} />
        <label className="text-sm md:col-span-2">
          CAS email template
          <select
            className={field}
            value={emailTemplate}
            onChange={(event) => setEmailTemplate(event.target.value)}
          >
            {EMAIL_TEMPLATES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <button
          className="rounded-md border border-line bg-white px-3 py-2 text-sm md:col-span-2"
          type="button"
          onClick={async () => {
            const form = new FormData();
            form.set("claimId", claimId);
            form.set("templateKey", emailTemplate);
            const preview = await actionPreviewCorrespondence(form);
            if ("error" in preview && preview.error) {
              setFillMsg(preview.error);
              return;
            }
            if (preview.to) setEmailTo(preview.to);
            setEmailSubject(preview.subject);
            setEmailBody(preview.body);
            const parts = [];
            if (preview.missing.length) parts.push(`Missing from the file: ${preview.missing.join(", ")}.`);
            if (preview.legalSignOffRequired) {
              parts.push("Legal wording needs solicitor sign-off before it is used live.");
            }
            setFillMsg(parts.join(" ") || "Filled from this file.");
          }}
        >
          Fill from this file
        </button>
        {fillMsg ? <p className="text-sm text-slate md:col-span-2">{fillMsg}</p> : null}
        <label className="text-sm">
          To
          <input
            name="to"
            required
            value={emailTo}
            onChange={(event) => setEmailTo(event.target.value)}
            placeholder="insurer@example.com"
            className={field}
          />
        </label>
        <label className="text-sm">
          Date of sending
          <input name="occurredAt" type="datetime-local" className={field} />
        </label>
        <label className="text-sm md:col-span-2">
          Subject
          <input
            name="subject"
            required
            value={emailSubject}
            onChange={(event) => setEmailSubject(event.target.value)}
            className={field}
          />
        </label>
        <label className="text-sm md:col-span-2">
          Body
          <textarea
            name="body"
            required
            rows={8}
            className={field}
            value={emailBody}
            onChange={(event) => setEmailBody(event.target.value)}
          />
        </label>
        <button className="rounded-md bg-navy px-4 py-2 text-sm text-white" type="submit">
          Record outgoing email
        </button>
        {emailMsg ? <p className="text-sm text-copper md:col-span-2">{emailMsg}</p> : null}
      </form>

      <form action={actionLogIncomingEmail} className="grid gap-3 rounded-xl border border-dashed border-line bg-paper p-5 md:grid-cols-2">
        <h2 className="font-serif text-xl text-navy-deep md:col-span-2">File an incoming email</h2>
        <input type="hidden" name="claimId" value={claimId} />
        <input type="hidden" name="actorId" value={handlerId} />
        <label className="text-sm">
          From
          <input name="from" required className={field} />
        </label>
        <label className="text-sm">
          Received
          <input name="occurredAt" type="datetime-local" className={field} />
        </label>
        <label className="text-sm md:col-span-2">
          Subject
          <input name="subject" required className={field} />
        </label>
        <label className="text-sm md:col-span-2">
          Body
          <textarea name="body" required rows={3} className={field} />
        </label>
        <button className="rounded-md border border-line bg-white px-4 py-2 text-sm md:col-span-2" type="submit">
          File incoming email
        </button>
      </form>

      <form
        className="grid gap-3 rounded-xl border border-line bg-card p-5 md:grid-cols-2"
        action={async (formData) => {
          const result = await actionSendWhatsApp(formData);
          setWaMsg(result.ok ? result.warning : result.error);
          router.refresh();
        }}
      >
        <h2 className="font-serif text-xl text-navy-deep md:col-span-2">Send WhatsApp</h2>
        <input type="hidden" name="claimId" value={claimId} />
        <input type="hidden" name="actorId" value={handlerId} />
        <label className="text-sm">
          Number
          <input name="to" required defaultValue={defaults.clientPhone} className={field} />
        </label>
        <label className="text-sm">
          Date of sending
          <input name="occurredAt" type="datetime-local" className={field} />
        </label>
        <label className="text-sm md:col-span-2">
          Message
          <textarea
            name="body"
            required
            rows={4}
            className={field}
            defaultValue={`Hello ${defaults.clientName || ""}, this is Complete Accident Solutions regarding file ${defaults.fileReference}.`}
          />
        </label>
        <button className="rounded-md bg-navy px-4 py-2 text-sm text-white" type="submit">
          Record outgoing WhatsApp
        </button>
        {waMsg ? <p className="text-sm text-copper md:col-span-2">{waMsg}</p> : null}
      </form>

      <form action={actionLogIncomingWhatsApp} className="grid gap-3 rounded-xl border border-dashed border-line bg-paper p-5 md:grid-cols-2">
        <h2 className="font-serif text-xl text-navy-deep md:col-span-2">File an incoming WhatsApp</h2>
        <input type="hidden" name="claimId" value={claimId} />
        <input type="hidden" name="actorId" value={handlerId} />
        <label className="text-sm">
          From number
          <input name="from" required defaultValue={defaults.clientPhone} className={field} />
        </label>
        <label className="text-sm">
          Received
          <input name="occurredAt" type="datetime-local" className={field} />
        </label>
        <label className="text-sm md:col-span-2">
          Message
          <textarea name="body" required rows={3} className={field} />
        </label>
        <button className="rounded-md border border-line bg-white px-4 py-2 text-sm md:col-span-2" type="submit">
          File incoming WhatsApp
        </button>
      </form>

      <form
        className="grid gap-3 rounded-xl border border-line bg-card p-5 md:grid-cols-2"
        action={async (formData) => {
          const result = await actionRecordCall(formData);
          setCallMsg(result.ok ? result.warning : result.error);
          router.refresh();
        }}
      >
        <h2 className="font-serif text-xl text-navy-deep md:col-span-2">Make or receive a call</h2>
        <p className="text-sm text-slate md:col-span-2">
          Record the call against the file. The prototype does not dial a live number. If there is no answer, you can create a call-back task for tomorrow.
        </p>
        <input type="hidden" name="claimId" value={claimId} />
        <input type="hidden" name="actorId" value={handlerId} />
        <label className="text-sm">
          Direction
          <select name="direction" className={field} defaultValue="outgoing">
            <option value="outgoing">Call made</option>
            <option value="incoming">Call received</option>
          </select>
        </label>
        <label className="text-sm">
          Who
          <select name="party" className={field} defaultValue={defaults.clientName || "Client"}>
            <option value={defaults.clientName || "Client"}>Client — {defaults.clientName || "Unknown"}</option>
            <option value={defaults.tpInsurer || "Third-party insurer"}>
              Third-party insurer — {defaults.tpInsurer || "Unknown"}
            </option>
            <option value="Own insurer">Own insurer</option>
            <option value="Other">Other</option>
          </select>
        </label>
        <label className="text-sm">
          Number
          <input name="number" required defaultValue={defaults.clientPhone || defaults.tpPhone} className={field} />
        </label>
        <label className="text-sm">
          When
          <input name="occurredAt" type="datetime-local" className={field} />
        </label>
        <label className="text-sm">
          Outcome
          <select name="outcome" className={field} defaultValue="connected">
            <option value="connected">Connected</option>
            <option value="voicemail">Voicemail</option>
            <option value="no_answer">No answer</option>
            <option value="engaged">Engaged</option>
            <option value="callback_requested">Call-back requested</option>
          </select>
        </label>
        <label className="flex items-end gap-2 text-sm">
          <input type="checkbox" name="createTask" value="yes" className="mb-2 h-4 w-4" />
          <span>If not connected, create a call-back task for tomorrow</span>
        </label>
        <label className="text-sm md:col-span-2">
          Notes
          <textarea name="notes" rows={3} className={field} />
        </label>
        <button className="rounded-md bg-navy px-4 py-2 text-sm text-white" type="submit">
          Record call
        </button>
        {callMsg ? <p className="text-sm text-copper md:col-span-2">{callMsg}</p> : null}
      </form>

      <form action={actionGenerateDocument} className="grid gap-3 rounded-xl border-2 border-teal bg-[#e8f4f2] p-5 md:grid-cols-2">
        <h2 className="font-serif text-xl text-navy-deep md:col-span-2">Generate a document</h2>
        <p className="text-sm text-slate md:col-span-2">
          Letters and emails are built from dates already on this file. Missing items are listed, not invented. Rebuttal wording
          needs solicitor sign-off before live use. Hire Pack is a separate pack.
        </p>
        <input type="hidden" name="claimId" value={claimId} />
        <input type="hidden" name="actorId" value={handlerId} />
        <label className="text-sm">
          Document
          <select name="templateKey" className={field} defaultValue="initial_tp_insurer">
            {DOCUMENT_TEMPLATES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.channel === "email" ? `Email: ${t.title}` : t.title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Letter date
          <input name="letterDate" type="date" className={field} />
        </label>
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input name="recordOnFile" type="checkbox" value="yes" defaultChecked />
          Also record this date on the file history
        </label>
        <button className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white" type="submit">
          Generate and open
        </button>
        <Link href={`/claims/${claimId}/hire-pack`} className="self-center text-sm font-semibold text-teal-dark underline">
          Open Hire Pack
        </Link>
      </form>

      {documents.length > 0 ? (
        <section className="rounded-xl border border-line bg-card p-5">
          <h2 className="font-serif text-xl text-navy-deep">Documents on this file</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {documents.map((d) => (
              <li key={String(d.id)}>
                {d.body_html ? (
                  <Link className="text-teal-dark underline" href={`/documents/${d.id}`}>
                    {String(d.title)} v{String(d.version)}
                  </Link>
                ) : (
                  <span>
                    {String(d.title)} v{String(d.version)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
