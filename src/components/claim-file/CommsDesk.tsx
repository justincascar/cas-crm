"use client";

import { useState, type ReactNode } from "react";
import { sentStatusWords } from "@/lib/domain/chase-status";
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
import { PAYMENT_REQUEST_EMAIL_TEMPLATE_KEY, isPaymentRequestEmailTemplate, paymentRequestPack } from "@/lib/email/payment-request-pack";
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
  companyDocuments = [],
  liabilityStatus,
  engineers,
  selectedEngineerId,
  preparedEngineerInstruction,
  chases,
  hireAgreements,
  preparedByKind,
  mailboxConnected = false,
  impecuniosityBlockReason = null,
  firstSection,
  repairVersion = "",
  overrideVersions = {},
  engineerVersion = "",
  insurerPositionVersion,
}: {
  claimId: string;
  handlerId: string;
  defaults: CommsContactDefaults;
  correspondence: CorrespondenceRow[];
  documents: DocumentRow[];
  companyDocuments?: DocumentRow[];
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
  /** The part of the page for the claim's likely next action. It opens first. */
  firstSection?: "documents" | "engineer" | "chases" | "email";
  repairVersion?: string;
  overrideVersions?: Record<string, string>;
  engineerVersion?: string;
  insurerPositionVersion?: string;
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
  const [filledBody, setFilledBody] = useState("");
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
    const template = templateKeyForRole(role, emailTemplate, liabilityStatus === "fault");
    applyTemplate(template);
    // R63: the matching template is filled from the file straight away; there is no separate Fill button.
    void fillFromFile(template, role, decision.address);
  }

  /** Fills subject and body (and To, if the template knows the address) from the file. */
  async function fillFromFile(template: string, role: string, currentTo: string) {
    if (!template) {
      setFillMsg(role ? "No template is available for this recipient. Type the message instead." : null);
      return;
    }
    const typedBody = emailBody.trim() !== "" && emailBody !== filledBody && emailBody !== "Dear Sir / Madam\n\n";
    if (typedBody && !window.confirm("Replace the message you have typed with the template filled from this file?")) return;
    const form = new FormData();
    form.set("claimId", claimId);
    form.set("templateKey", template);
    const preview = await actionPreviewCorrespondence(form);
    if ("error" in preview && preview.error) {
      setFillMsg(preview.error);
      return;
    }
    const to = "to" in preview && typeof preview.to === "string" ? preview.to : "";
    const subject = "subject" in preview && typeof preview.subject === "string" ? preview.subject : "";
    const body = "body" in preview && typeof preview.body === "string" ? preview.body : "";
    if (to && !currentTo.trim()) {
      setEmailTo(to);
      setFilledAddress(to);
    }
    setEmailSubject(subject);
    setEmailBody(body);
    setFilledBody(body);
    const missing = "missing" in preview && Array.isArray(preview.missing) ? preview.missing : [];
    const legalSignOffRequired = "legalSignOffRequired" in preview && Boolean(preview.legalSignOffRequired);
    const parts = [];
    if (missing.length) parts.push(`Missing from the file: ${missing.join(", ")}.`);
    if (legalSignOffRequired) parts.push("Legal wording needs solicitor sign-off before it is used live.");
    setFillMsg(parts.join(" ") || "Filled from this file. Check it before sending.");
  }

  const visibleTemplates = emailTemplatesForRole(sendTo, liabilityStatus === "fault");
  const attachable = attachmentChoices([...companyDocuments, ...documents]);
  const packPreview = paymentRequestPack({
    templateKey: PAYMENT_REQUEST_EMAIL_TEMPLATE_KEY,
    claimDocuments: documents,
    companyDocuments,
  });
  const pack = paymentRequestPack({
    templateKey: emailTemplate,
    claimDocuments: documents,
    companyDocuments,
  });
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);

  function applyTemplate(next: string) {
    const wasPack = isPaymentRequestEmailTemplate(emailTemplate);
    const nextPack = isPaymentRequestEmailTemplate(next);
    if (nextPack && !wasPack) {
      setAttachmentIds(packPreview.selectedIds);
    } else if (wasPack && !nextPack && sameIds(attachmentIds, packPreview.selectedIds)) {
      setAttachmentIds([]);
    }
    setEmailTemplate(next);
  }

  const sections = { documents: true, engineer: true, chases: chases.length > 0, email: true, whatsapp: true, calls: true, onFile: true };
  const first: string = firstSection || "email";
  const order = (key: string) => (key === first ? 0 : 1);

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold" data-email-status>
        {mailboxConnected ? `Email: live – sends from ${CAS_CLAIMS_MAILBOX} when you click Send` : "Email: simulated – nothing leaves the CRM"}
      </p>
      <div className="flex flex-col gap-3">
      {sections.documents ? (
        <Fold key="documents" title="Letters and documents" open={first === "documents"} order={order("documents")}>
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
        </Fold>
      ) : null}
      {sections.engineer ? (
        <Fold key="engineer" title="Engineer" open={first === "engineer"} order={order("engineer")}>
      <InstructEngineerPanel
        claimId={claimId}
        engineers={engineers}
        selectedEngineerId={selectedEngineerId}
        prepared={preparedEngineerInstruction}
        mailboxConnected={mailboxConnected}
        returnTo={`/claims/${claimId}/work/comms`}
        engineerVersion={engineerVersion}
      />
        </Fold>
      ) : null}
      {sections.chases ? (
        <Fold key="chases" title="Chases" open={first === "chases"} order={order("chases")}>
      {chases.map((chase) => (
        <ChasePanel
          key={chase.kind}
          claimId={claimId}
          chase={chase}
          prepared={preparedByKind[chase.kind] || null}
          agreements={chase.kind === "hire_agreement_renewal" ? hireAgreements : undefined}
          mailboxConnected={mailboxConnected}
          returnTo={`/claims/${claimId}/work/comms`}
          repairVersion={repairVersion}
          insurerPositionVersion={insurerPositionVersion}
          overrideVersion={overrideVersions[chase.kind] || ""}
        />
      ))}
        </Fold>
      ) : null}
      {sections.email ? (
        <Fold key="email" title="Email" open={first === "email"} order={order("email")}>
      <ValidatedForm
        className="grid gap-3 rounded-xl border border-line bg-card p-5 md:grid-cols-2"
        action={async (formData) => {
          const chosen = formData.getAll("attachmentId").map((value) => String(value));
          if (attachmentsExceedMailboxLimit(selectedAttachmentBytes(attachable, chosen))) {
            setEmailMsg(ATTACHMENT_TOO_LARGE_MESSAGE);
            return;
          }
          const result = await actionSendEmail(formData);
          const reportNotice = result.ok && "engineerReportNotice" in result ? result.engineerReportNotice : "";
          setEmailMsg(result.ok ? [reportNotice, result.warning].filter(Boolean).join(" ") : result.error);
          router.refresh();
        }}
      >
        <h2 className="font-serif text-xl text-navy-deep md:col-span-2">Send email</h2>
        <p className="text-sm text-slate md:col-span-2">
          {mailboxConnected
            ? `Fill the message, then click Send. It goes from ${CAS_CLAIMS_MAILBOX}. It is not sent until then. Hire pack cover letters are sent from here in the same way.`
            : `Pick a CAS email template to fill from this file.`}
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
            onChange={(event) => {
              applyTemplate(event.target.value);
              void fillFromFile(event.target.value, sendTo, emailTo);
            }}
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
        {sendTo === "third_party" || sendTo === "representative" ? (
          <p className="text-sm text-slate md:col-span-2">
            Payment chase 1 and 2 are no longer free-standing templates. The repair invoice and total-loss settlement chases prepare the payment email, with the figure and bank details filled in. Nothing is sent until you click Send on that chase.
          </p>
        ) : null}
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
          {pack.applies ? (
            <p className="text-xs text-slate">
              {visibleTemplates.find((template) => template.key === emailTemplate)?.title ?? "This payment chase"} ticks the payment-request pack
              that is already stored. Check the ticks. Nothing is sent until you click Send. Untick a document, or tick others. A required document
              that is not stored is named below and is not attached.
            </p>
          ) : (
            <p className="text-xs text-slate">
              Nothing is attached unless you tick it. Only documents already stored on this claim are listed. CAS&apos;s own insurance certificate
              is listed as well when it has been stored under Settings.
            </p>
          )}
          {pack.applies && pack.missing.length > 0 ? (
            <ul className="space-y-1 rounded-md border border-warn/40 bg-[#fff6e8] px-3 py-2 text-sm">
              {pack.missing.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
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
        </Fold>
      ) : null}
      {sections.whatsapp ? (
        <Fold key="whatsapp" title="WhatsApp" open={first === "whatsapp"} order={order("whatsapp")}>
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
        </Fold>
      ) : null}
      {sections.calls ? (
        <Fold key="calls" title="Calls" open={first === "calls"} order={order("calls")}>
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
        </Fold>
      ) : null}
      {sections.onFile ? (
        <Fold key="onFile" title="On this file" open={first === "onFile"} order={order("onFile")}>
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
                <div className="text-xs text-slate">{sentStatusWords(row.sent_status ? String(row.sent_status) : null)}</div>
                {attachmentSummary(row.attachments_json) ? (
                  <div className="text-xs text-slate">Attached: {attachmentSummary(row.attachments_json)}</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
        </Fold>
      ) : null}
      </div>
    </div>
  );
}

/** One part of the Messages page. Closed unless it is the claim's likely next action. */
function Fold({ title, open, order, children }: { title: string; open: boolean; order: number; children: ReactNode }) {
  return (
    <details open={open || undefined} style={{ order }} className="rounded-xl border border-line bg-card" data-comms-section={title}>
      <summary className="cursor-pointer px-5 py-3 font-serif text-lg text-navy-deep">{title}</summary>
      <div className="space-y-4 px-2 pb-3 sm:px-3">{children}</div>
    </details>
  );
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((id, index) => id === b[index]);
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
