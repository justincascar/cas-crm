"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  actionLogIncomingEmail,
  actionLogIncomingWhatsApp,
  actionPreviewCorrespondence,
  actionRecordCall,
  actionSendEmail,
  actionSendWhatsApp,
} from "@/app/actions";
import { DocumentGenerateForm } from "@/components/DocumentGenerateForm";
import { InstructEngineerPanel } from "@/components/InstructEngineerPanel";
import { ChasePanel, type HireAgreementHistoryRow } from "@/components/ChasePanel";
import { ValidatedForm } from "@/components/ValidatedForm";
import { emailTemplatesForRole, templateKeyForRole } from "@/lib/documents/email-templates";
import { CAS_CLAIMS_MAILBOX } from "@/lib/constants";
import { formatUkDateTime } from "@/lib/dates";
import {
  ATTACHMENT_TOO_LARGE_MESSAGE,
  NO_STORED_DOCUMENTS_MESSAGE,
  attachmentChoices,
  attachmentsExceedMailboxLimit,
  selectedAttachmentBytes,
} from "@/lib/email/attachments";
import { applySendToChoice, buildSendToOptions, type SendToRole } from "@/lib/email/send-to";
import type { ChaseView } from "@/lib/db/chase";
import Link from "next/link";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export type CommsContactDefaults = {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  tpInsurer: string;
  tpEmail: string;
  ownInsurerEmail: string;
  tpPhone: string;
  representativeRecorded: boolean;
  representativeEmail: string;
  engineerInstructed: boolean;
  engineerEmail: string;
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
  liabilityStatus,
  engineers,
  selectedEngineerId,
  preparedEngineerInstruction,
  chases,
  hireAgreements,
  preparedByKind,
  mailboxConnected = false,
  impecuniosityBlockReason = null,
}: {
  claimId: string;
  handlerId: string;
  defaults: CommsContactDefaults;
  correspondence: CorrespondenceRow[];
  documents: DocumentRow[];
  liabilityStatus: string;
  engineers: Array<{ id: string; name: string; address: string; email: string; active: number }>;
  selectedEngineerId: string;
  preparedEngineerInstruction: {
    id: string;
    subject: string | null;
    to_address: string | null;
    body: string | null;
    created_at: string;
  } | null;
  chases: ChaseView[];
  hireAgreements: HireAgreementHistoryRow[];
  preparedByKind: Record<
    string,
    {
      id: string;
      subject: string | null;
      to_address: string | null;
      body: string | null;
      created_at: string;
    } | null
  >;
  mailboxConnected?: boolean;
  impecuniosityBlockReason?: string | null;
}) {
  const router = useRouter();
  const defaultSubject = `Our ref: ${defaults.fileReference}  Your policy: ${defaults.policyRef || "…"}`;
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [emailTo, setEmailTo] = useState("");
  const [sendTo, setSendTo] = useState("");
  const [filledAddress, setFilledAddress] = useState("");
  const [sendToNote, setSendToNote] = useState<string | null>(null);
  const [emailSubject, setEmailSubject] = useState(defaultSubject);
  const [emailBody, setEmailBody] = useState("Dear Sir / Madam\n\n");
  const [emailTemplate, setEmailTemplate] = useState("");
  const [fillMsg, setFillMsg] = useState<string | null>(null);
  const [waMsg, setWaMsg] = useState<string | null>(null);
  const [callMsg, setCallMsg] = useState<string | null>(null);
  const sendToOptions = buildSendToOptions({
    clientEmail: defaults.clientEmail,
    ownInsurerEmail: defaults.ownInsurerEmail,
    thirdPartyEmail: defaults.tpEmail,
    representativeRecorded: defaults.representativeRecorded,
    representativeEmail: defaults.representativeEmail,
    engineerInstructed: defaults.engineerInstructed,
    engineerEmail: defaults.engineerEmail,
  });

  function chooseRecipient(role: string) {
    const apply = (confirmed: boolean) =>
      applySendToChoice({
        role: role as SendToRole,
        options: sendToOptions,
        currentAddress: emailTo,
        filledAddress,
        confirmed,
      });
    let decision = apply(false);
    if (decision.needsConfirm) {
      const ok = window.confirm("Replace the address already typed in To?");
      if (!ok) return;
      decision = apply(true);
    }
    if (decision.needsConfirm) return;
    setSendTo(role);
    setEmailTo(decision.address);
    setFilledAddress(decision.filledAddress);
    setSendToNote(decision.missingMessage);
    setEmailTemplate((current) => templateKeyForRole(role, current));
  }

  const visibleTemplates = emailTemplatesForRole(sendTo);
  const attachable = attachmentChoices(documents);
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);

  return (
    <div className="space-y-6">
      <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">
        {mailboxConnected
          ? `Email sends from ${CAS_CLAIMS_MAILBOX} when you click Send. A failure is shown here and is not recorded as sent. WhatsApp and calls are still recorded on this file and do not leave this computer. Nothing sends itself.`
          : `Microsoft 365 not yet connected. Email, WhatsApp and calls are recorded on this file. They do not leave this computer until CAS's mailbox, WhatsApp Business account and telephone system are connected. A click is not proof of delivery. Instruct Engineer prepares a letter and opens it in your own email client — it is not auto-sent from ${CAS_CLAIMS_MAILBOX}.`}
      </p>

      <InstructEngineerPanel
        claimId={claimId}
        engineers={engineers}
        selectedEngineerId={selectedEngineerId}
        prepared={preparedEngineerInstruction}
        mailboxConnected={mailboxConnected}
        returnTo={`/claims/${claimId}/work/comms`}
      />

      {chases.map((chase) => (
        <ChasePanel
          key={chase.kind}
          claimId={claimId}
          chase={chase}
          prepared={preparedByKind[chase.kind] || null}
          agreements={chase.kind === "hire_agreement_renewal" ? hireAgreements : undefined}
          mailboxConnected={mailboxConnected}
          returnTo={`/claims/${claimId}/work/comms`}
        />
      ))}

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
                {attachmentSummary(row.attachments_json) ? (
                  <div className="text-xs text-slate">Attached: {attachmentSummary(row.attachments_json)}</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ValidatedForm
        className="grid gap-3 rounded-xl border border-line bg-card p-5 md:grid-cols-2"
        action={async (formData) => {
          const chosen = formData.getAll("attachmentId").map((value) => String(value));
          if (attachmentsExceedMailboxLimit(selectedAttachmentBytes(attachable, chosen))) {
            setEmailMsg(ATTACHMENT_TOO_LARGE_MESSAGE);
            return;
          }
          const result = await actionSendEmail(formData);
          setEmailMsg(result.ok ? result.warning : result.error);
          router.refresh();
        }}
      >
        <h2 className="font-serif text-xl text-navy-deep md:col-span-2">Send email</h2>
        <p className="text-sm text-slate md:col-span-2">
          {mailboxConnected
            ? `Fill the message, then click Send. It goes from ${CAS_CLAIMS_MAILBOX}. It is not sent until then. Hire pack cover letters are sent from here in the same way.`
            : "Microsoft 365 not yet connected. Pick a CAS email template to fill from this file, then record the simulated send. Nothing leaves this computer."}
        </p>
        <input type="hidden" name="claimId" value={claimId} />
        <input type="hidden" name="actorId" value={handlerId} />
        <input type="hidden" name="templateKey" value={emailTemplate} />
        <label className="text-sm md:col-span-2">
          Send to
          <select className={field} value={sendTo} onChange={(event) => chooseRecipient(event.target.value)}>
            <option value="">Choose who this is going to</option>
            {sendToOptions.map((option) => (
              <option key={option.role} value={option.role}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          To
          <input
            name="to"
            required
            value={emailTo}
            onChange={(event) => setEmailTo(event.target.value)}
            placeholder="Email address"
            className={field}
          />
        </label>
        {sendToNote ? <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-3 py-2 text-sm md:col-span-2">{sendToNote}</p> : null}
        <label className="text-sm md:col-span-2">
          CAS email template
          <select
            className={field}
            value={emailTemplate}
            onChange={(event) => setEmailTemplate(event.target.value)}
          >
            {visibleTemplates.length === 0 ? (
              <option value="">
                {sendTo ? "No email template for this recipient" : "Choose who this is going to first"}
              </option>
            ) : (
              visibleTemplates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.title}
                </option>
              ))
            )}
          </select>
        </label>
        {sendTo === "engineer" ? (
          <p className="text-sm text-slate md:col-span-2">
            No saved email template is written for an engineer. Type the message here, or use Instruct Engineer above.
          </p>
        ) : null}
        {sendTo === "own_insurer" ? (
          <p className="text-sm text-slate md:col-span-2">
            No saved email template is written for the client's own insurer. Type the message here. The fault claim letter stays under Generate a document.
          </p>
        ) : null}
        <button
          className="rounded-md border border-line bg-white px-3 py-2 text-sm md:col-span-2"
          type="button"
          onClick={async () => {
            if (!emailTemplate) {
              setFillMsg(sendTo ? "No template is available for this recipient. Type the message instead." : "Choose who this is going to first.");
              return;
            }
            const form = new FormData();
            form.set("claimId", claimId);
            form.set("templateKey", emailTemplate);
            const preview = await actionPreviewCorrespondence(form);
            if ("error" in preview && preview.error) {
              setFillMsg(preview.error);
              return;
            }
            const to = "to" in preview && typeof preview.to === "string" ? preview.to : "";
            const subject = "subject" in preview && typeof preview.subject === "string" ? preview.subject : "";
            const body = "body" in preview && typeof preview.body === "string" ? preview.body : "";
            if (to && to.trim() !== emailTo.trim()) {
              const typed = emailTo.trim() !== "" && emailTo.trim() !== filledAddress.trim();
              if (typed && !window.confirm("Replace the address already typed in To?")) {
                setEmailSubject(subject);
                setEmailBody(body);
              } else {
                setEmailTo(to);
                setFilledAddress(to);
                setEmailSubject(subject);
                setEmailBody(body);
              }
            } else {
              if (to) {
                setEmailTo(to);
                setFilledAddress(to);
              }
              setEmailSubject(subject);
              setEmailBody(body);
            }
            const missing = "missing" in preview && Array.isArray(preview.missing) ? preview.missing : [];
            const legalSignOffRequired =
              "legalSignOffRequired" in preview && Boolean(preview.legalSignOffRequired);
            const parts = [];
            if (missing.length) parts.push(`Missing from the file: ${missing.join(", ")}.`);
            if (legalSignOffRequired) {
              parts.push("Legal wording needs solicitor sign-off before it is used live.");
            }
            setFillMsg(parts.join(" ") || "Filled from this file.");
          }}
        >
          Fill from this file
        </button>
        {fillMsg ? <p className="text-sm text-slate md:col-span-2">{fillMsg}</p> : null}
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
        <fieldset className="space-y-2 md:col-span-2">
          <legend className="text-sm">Documents to attach</legend>
          <p className="text-xs text-slate">Nothing is attached unless you tick it. Only documents already stored on this claim are listed.</p>
          {attachable.length === 0 ? (
            <p className="text-sm">{NO_STORED_DOCUMENTS_MESSAGE}</p>
          ) : (
            <ul className="space-y-1">
              {attachable.map((item) => (
                <li key={item.id}>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="attachmentId"
                      value={item.id}
                      checked={attachmentIds.includes(item.id)}
                      onChange={(event) =>
                        setAttachmentIds((current) =>
                          event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id),
                        )
                      }
                    />
                    <span>{item.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {attachmentsExceedMailboxLimit(selectedAttachmentBytes(attachable, attachmentIds)) ? (
            <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-3 py-2 text-sm">{ATTACHMENT_TOO_LARGE_MESSAGE}</p>
          ) : null}
        </fieldset>
        <button className="rounded-md bg-navy px-4 py-2 text-sm text-white" type="submit">
          {mailboxConnected ? `Send from ${CAS_CLAIMS_MAILBOX}` : "Record outgoing email"}
        </button>
        {emailMsg ? <p className="text-sm text-copper md:col-span-2">{emailMsg}</p> : null}
      </ValidatedForm>

      <ValidatedForm action={actionLogIncomingEmail} className="grid gap-3 rounded-xl border border-dashed border-line bg-paper p-5 md:grid-cols-2">
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
      </ValidatedForm>

      <ValidatedForm
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
      </ValidatedForm>

      <ValidatedForm action={actionLogIncomingWhatsApp} className="grid gap-3 rounded-xl border border-dashed border-line bg-paper p-5 md:grid-cols-2">
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
      </ValidatedForm>

      <ValidatedForm
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
      </ValidatedForm>

      <DocumentGenerateForm
        claimId={claimId}
        handlerId={handlerId}
        liabilityStatus={liabilityStatus}
        variant="comms"
        impecuniosityBlockReason={impecuniosityBlockReason}
      />

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

function attachmentSummary(value: string | number | null | undefined): string {
  if (!value) return "";
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!Array.isArray(parsed)) return "";
    return parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "").join("; ");
  } catch {
    return "";
  }
}
