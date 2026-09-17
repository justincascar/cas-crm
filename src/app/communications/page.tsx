import Link from "next/link";
import { PageHeader } from "@/components/ClaimTable";
import { formatUkDateTime } from "@/lib/dates";
import { listCorrespondence } from "@/lib/db/queries";

function channelLabel(channel: string, direction: string) {
  if (channel === "whatsapp") return `${direction} WhatsApp`;
  if (channel === "phone") return direction === "outgoing" ? "Call made" : "Call received";
  if (channel === "email") return `${direction} email`;
  return `${direction} ${channel}`;
}

export default function CommunicationsPage() {
  const rows = listCorrespondence();
  return (
    <div>
      <PageHeader
        title="Communications"
        subtitle="Email, WhatsApp and telephone are recorded against the claim file. Live mailbox, WhatsApp Business and telephony still need connecting before anything leaves the office. Open a file to send, receive or generate a document."
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
                <td>{String(r.sent_status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
