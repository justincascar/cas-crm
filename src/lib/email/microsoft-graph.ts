import { CAS_CLAIMS_MAILBOX } from "../constants";

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

export async function sendMailboxMessage(message: { to: string; subject: string; body: string }): Promise<void> {
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

  let response: Response;
  try {
    response = await fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(CAS_CLAIMS_MAILBOX)}/sendMail`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "Text", content: body },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new MailboxSendError("unreachable", UNREACHABLE_ERROR);
  }

  if (response.status === 202 || response.status === 200) return;
  if (response.status === 401 || response.status === 403) {
    throw new MailboxSendError("configuration", PERMISSION_ERROR);
  }
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    throw new MailboxSendError("unreachable", UNREACHABLE_ERROR);
  }
  throw new MailboxSendError("rejected", REJECTED_ERROR);
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
