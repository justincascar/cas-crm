import { CAS_CLAIMS_MAILBOX } from "../constants";
import {
  ATTACHMENT_TOO_LARGE_MESSAGE,
  GRAPH_INLINE_ATTACHMENT_LIMIT_BYTES,
  GRAPH_UPLOAD_SESSION_LIMIT_BYTES,
  attachmentsExceedMailboxLimit,
} from "./attachments";

/** Environment names Justin supplies after the Microsoft 365 app registration exists. */
export const M365_TENANT_ID_ENV = "CAS_M365_TENANT_ID";
export const M365_CLIENT_ID_ENV = "CAS_M365_CLIENT_ID";
export const M365_CLIENT_SECRET_ENV = "CAS_M365_CLIENT_SECRET";

export type MailboxFailureCode = "not_connected" | "configuration" | "unreachable" | "rejected";

export class MailboxSendError extends Error {
  readonly code: MailboxFailureCode;

  constructor(code: MailboxFailureCode, message: string) {
    super(message);
    this.name = "MailboxSendError";
    this.code = code;
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

let fetchImpl: FetchLike = (input, init) => fetch(input, init);

/** Tests replace the network call. Production always uses the platform fetch. */
export function setMailboxFetchForTests(next: FetchLike | null) {
  fetchImpl = next ?? ((input, init) => fetch(input, init));
}

export function mailboxCredentials(): { tenantId: string; clientId: string; clientSecret: string } | null {
  const tenantId = process.env[M365_TENANT_ID_ENV]?.trim() || "";
  const clientId = process.env[M365_CLIENT_ID_ENV]?.trim() || "";
  const clientSecret = process.env[M365_CLIENT_SECRET_ENV]?.trim() || "";
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}

/** True only when all three credentials are present. It does not mean a send has succeeded. */
export function mailboxIsConnected(): boolean {
  return mailboxCredentials() !== null;
}

function withoutSecret(message: string, secret: string): string {
  if (!secret) return message;
  return message.split(secret).join("the client secret");
}

const CONFIGURATION_ERROR =
  "Microsoft 365 rejected the saved credentials. Check CAS_M365_TENANT_ID, CAS_M365_CLIENT_ID and CAS_M365_CLIENT_SECRET. Nothing was sent.";
const UNREACHABLE_ERROR =
  "Microsoft 365 could not be reached. Nothing was sent. The prepared email is still here — try again when the connection is back.";
const PERMISSION_ERROR =
  "Microsoft 365 refused permission to send as claims@cascar.co.uk. Check the app is allowed to send mail for that mailbox. Nothing was sent.";
const REJECTED_ERROR = "Microsoft 365 refused this email. Nothing was sent. The prepared email is still here.";
const DRAFT_PERMISSION_ERROR =
  "Microsoft 365 refused permission to save a draft in the claims mailbox. Documents can only be attached to a draft, and this app is not allowed to create one. Nothing was sent.";
const DRAFT_LEFT_BEHIND =
  "The email was not sent, but a draft could not be removed from the claims mailbox. Delete that draft in Outlook before trying again.";

/** Microsoft's own example keeps each uploaded piece under 4 MB. 2 MB matches that example. */
const UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;

export type MailboxAttachment = {
  name: string;
  contentType: string;
  content: Buffer;
};

export async function sendMailboxMessage(message: {
  to: string;
  subject: string;
  body: string;
  attachments?: MailboxAttachment[];
}): Promise<void> {
  const credentials = mailboxCredentials();
  if (!credentials) {
    throw new MailboxSendError(
      "not_connected",
      "Microsoft 365 is not connected. Open the email in your own email client. Nothing was sent from claims@cascar.co.uk.",
    );
  }
  const to = message.to.trim();
  const subject = message.subject.trim();
  const body = message.body.trim();
  if (!to || !subject || !body) {
    throw new MailboxSendError("rejected", "To, subject and body are required. Nothing was sent.");
  }

  let token: string;
  try {
    token = await accessToken(credentials);
  } catch (error) {
    if (error instanceof MailboxSendError) throw error;
    throw new MailboxSendError("unreachable", withoutSecret(UNREACHABLE_ERROR, credentials.clientSecret));
  }

  const attachments = message.attachments ?? [];
  if (attachments.length === 0) {
    await postSendMail(token, { to, subject, body });
    return;
  }
  const total = attachments.reduce((sum, item) => sum + item.content.length, 0);
  if (attachmentsExceedMailboxLimit(total) || attachments.some((item) => item.content.length > GRAPH_UPLOAD_SESSION_LIMIT_BYTES)) {
    throw new MailboxSendError("rejected", ATTACHMENT_TOO_LARGE_MESSAGE);
  }

  let draftId = "";
  try {
    draftId = await createDraft(token, { to, subject, body });
    for (const item of attachments) {
      if (item.content.length < GRAPH_INLINE_ATTACHMENT_LIMIT_BYTES) await addInlineAttachment(token, draftId, item);
      else await addUploadSessionAttachment(token, draftId, item);
    }
    await sendDraft(token, draftId);
  } catch (error) {
    if (draftId) await discardDraft(token, draftId, error);
    throw error;
  }
}

function messagesCollectionUrl(): string {
  return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(CAS_CLAIMS_MAILBOX)}/messages`;
}

function draftUrl(draftId: string, suffix = ""): string {
  return `${messagesCollectionUrl()}/${encodeURIComponent(draftId)}${suffix}`;
}

function graphHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function failureForStatus(status: number, draft: boolean): MailboxSendError {
  if (status === 401 || status === 403) {
    return new MailboxSendError("configuration", draft ? DRAFT_PERMISSION_ERROR : PERMISSION_ERROR);
  }
  if (status === 408 || status === 429 || status >= 500) {
    return new MailboxSendError("unreachable", UNREACHABLE_ERROR);
  }
  return new MailboxSendError("rejected", REJECTED_ERROR);
}

async function graphFetch(url: string, init: RequestInit, timeoutMs = 20_000): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error instanceof MailboxSendError) throw error;
    throw new MailboxSendError("unreachable", UNREACHABLE_ERROR);
  }
}

async function postSendMail(token: string, message: { to: string; subject: string; body: string }): Promise<void> {
  const response = await graphFetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(CAS_CLAIMS_MAILBOX)}/sendMail`, {
    method: "POST",
    headers: graphHeaders(token),
    body: JSON.stringify({
      message: {
        subject: message.subject,
        body: { contentType: "Text", content: message.body },
        toRecipients: [{ emailAddress: { address: message.to } }],
      },
      saveToSentItems: true,
    }),
  });
  if (response.status === 202 || response.status === 200) return;
  throw failureForStatus(response.status, false);
}

async function createDraft(token: string, message: { to: string; subject: string; body: string }): Promise<string> {
  const response = await graphFetch(messagesCollectionUrl(), {
    method: "POST",
    headers: graphHeaders(token),
    body: JSON.stringify({
      subject: message.subject,
      body: { contentType: "Text", content: message.body },
      toRecipients: [{ emailAddress: { address: message.to } }],
    }),
  });
  if (response.status !== 201 && response.status !== 200) throw failureForStatus(response.status, true);
  const payload = (await response.json()) as { id?: string };
  const id = String(payload.id || "").trim();
  if (!id) throw new MailboxSendError("rejected", REJECTED_ERROR);
  return id;
}

async function addInlineAttachment(token: string, draftId: string, item: MailboxAttachment): Promise<void> {
  const response = await graphFetch(draftUrl(draftId, "/attachments"), {
    method: "POST",
    headers: graphHeaders(token),
    body: JSON.stringify({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: item.name,
      contentType: item.contentType,
      contentBytes: item.content.toString("base64"),
    }),
  }, 60_000);
  if (response.status !== 201 && response.status !== 200) throw failureForStatus(response.status, true);
}

async function addUploadSessionAttachment(token: string, draftId: string, item: MailboxAttachment): Promise<void> {
  const opened = await graphFetch(
    draftUrl(draftId, "/attachments/createUploadSession"),
    {
      method: "POST",
      headers: graphHeaders(token),
      body: JSON.stringify({
        AttachmentItem: {
          attachmentType: "file",
          name: item.name,
          size: item.content.length,
          contentType: item.contentType,
        },
      }),
    },
    60_000,
  );
  if (opened.status !== 200 && opened.status !== 201) throw failureForStatus(opened.status, true);
  const payload = (await opened.json()) as { uploadUrl?: string };
  const uploadUrl = assertUploadUrl(String(payload.uploadUrl || ""));
  const total = item.content.length;
  let start = 0;
  let steps = 0;
  const maxSteps = Math.ceil(total / UPLOAD_CHUNK_BYTES) + 2;
  while (start < total) {
    if (steps >= maxSteps) throw new MailboxSendError("rejected", REJECTED_ERROR);
    steps += 1;
    const endExclusive = Math.min(start + UPLOAD_CHUNK_BYTES, total);
    const slice = item.content.subarray(start, endExclusive);
    const bytes = new Uint8Array(slice.byteLength);
    bytes.set(slice);
    const put = await graphFetch(
      uploadUrl,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Range": `bytes ${start}-${endExclusive - 1}/${total}`,
        },
        body: bytes,
      },
      120_000,
    );
    if (endExclusive >= total) {
      if (put.status !== 200 && put.status !== 201) throw failureForStatus(put.status, true);
      return;
    }
    if (put.status !== 200 && put.status !== 202) throw failureForStatus(put.status, true);
    const progress = (await put.json().catch(() => ({}))) as { nextExpectedRanges?: string[] };
    const next = Number(String(progress.nextExpectedRanges?.[0] || "").split("-")[0]);
    start = Number.isFinite(next) && next > start ? next : endExclusive;
  }
}

function assertUploadUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MailboxSendError("rejected", REJECTED_ERROR);
  }
  const host = url.hostname.toLowerCase();
  const allowed =
    host === "outlook.office.com" ||
    host === "outlook.office365.com" ||
    host.endsWith(".outlook.office.com") ||
    host.endsWith(".outlook.office365.com");
  if (url.protocol !== "https:" || !allowed) throw new MailboxSendError("rejected", REJECTED_ERROR);
  return url.toString();
}

async function sendDraft(token: string, draftId: string): Promise<void> {
  const response = await graphFetch(draftUrl(draftId, "/send"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }, 60_000);
  if (response.status === 202 || response.status === 200) return;
  throw failureForStatus(response.status, true);
}

async function discardDraft(token: string, draftId: string, original: unknown): Promise<void> {
  try {
    const response = await graphFetch(draftUrl(draftId), { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 204 || response.status === 200 || response.status === 404) return;
  } catch {
    // The original send failure is what the handler sees, plus the fact the draft may remain.
  }
  const first = original instanceof Error ? original.message : REJECTED_ERROR;
  throw new MailboxSendError("rejected", `${first} ${DRAFT_LEFT_BEHIND}`);
}

async function accessToken(credentials: { tenantId: string; clientId: string; clientSecret: string }): Promise<string> {
  if (/[/?#\s]/.test(credentials.tenantId)) {
    throw new MailboxSendError("configuration", CONFIGURATION_ERROR);
  }
  let response: Response;
  try {
    response = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(credentials.tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new MailboxSendError("unreachable", UNREACHABLE_ERROR);
  }
  if (response.status === 400 || response.status === 401) {
    throw new MailboxSendError("configuration", CONFIGURATION_ERROR);
  }
  if (!response.ok) {
    throw new MailboxSendError("unreachable", UNREACHABLE_ERROR);
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new MailboxSendError("configuration", CONFIGURATION_ERROR);
  }
  return payload.access_token;
}
