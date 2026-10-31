import Link from "next/link";
import { PageHeader } from "@/components/ClaimTable";
import { EmailSendModeBanner } from "@/components/EmailSendModeBanner";
import { formatUkDateTime } from "@/lib/dates";
import { requireStaff } from "@/lib/auth/session";
import { listCorrespondence } from "@/lib/db/queries";
import { CAS_CLAIMS_MAILBOX } from "@/lib/constants";
import { emailSendBanner } from "@/lib/email/send-mode";
import { sentStatusWords } from "@/lib/domain/chase-status";

function channelLabel(channel: string, direction: string) {
  const way = direction === "outgoing" ? "Outgoing" : direction === "incoming" ? "Incoming" : direction;
  if (channel === "whatsapp") return `${way} WhatsApp`;
  if (channel === "phone") return direction === "outgoing" ? "Call made" : "Call received";
  if (channel === "email") return `${way} email`;
  return `${way} ${channel}`;
}

export default async function CommunicationsPage() {
  await requireStaff();
  const rows = listCorrespondence();
  const banner = emailSendBanner();
  return (
    <div className="space-y-4">
      <EmailSendModeBanner />
      <PageHeader
        title="Communications"
        subtitle={
          banner.mode === "live"
            ? `Email sends from ${CAS_CLAIMS_MAILBOX} when a person clicks Send on a file. WhatsApp Business and telephony are not connected. Incoming email is not read.`
            : `${banner.text}. Email, WhatsApp and telephone are recorded against the claim file. Nothing is sent from ${CAS_CLAIMS_MAILBOX}. Open a file to prepare an email.`
        }
      />
      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>When</th>
              <th>File</th>
              <th>Channel</th>
              <th>Subject</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td>{formatUkDateTime(String(r.created_at))}</td>
                <td>
                  <Link className="ref text-teal-dark hover:underline" href={`/claims/${r.claim_id}/work/comms`}>
                    {String(r.file_reference)}
                  </Link>
                </td>
                <td>
                  {channelLabel(String(r.channel), String(r.direction))}
                  {Number(r.unread) ? " · unread" : ""}
                </td>
                <td>
                  {String(r.subject)}
                  <div className="text-xs text-slate">{String(r.preview || "")}</div>
                </td>
                <td>{sentStatusWords(r.sent_status ? String(r.sent_status) : null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
