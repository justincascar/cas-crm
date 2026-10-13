"use client";

import { CAS_CLAIMS_MAILBOX } from "@/lib/constants";
import { SIMULATED_EMAIL_BANNER } from "@/lib/email/send-mode-copy";

export function SendPreparedEmailForm({
  claimId,
  correspondenceId,
  returnTo,
  liveSending = false,
}: {
  claimId: string;
  correspondenceId: string;
  returnTo: string;
  liveSending?: boolean;
}) {
  return (
    <form
      method="post"
      action={`/claims/${claimId}/send-email`}
      onSubmit={(event) => {
        const button = event.currentTarget.querySelector("button");
        if (button instanceof HTMLButtonElement) button.disabled = true;
      }}
    >
      <input type="hidden" name="correspondenceId" value={correspondenceId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button className="min-h-11 rounded-md bg-teal px-3 py-2 text-sm font-semibold text-white" type="submit">
        {liveSending ? `Send from ${CAS_CLAIMS_MAILBOX}` : "Record simulated send"}
      </button>
    </form>
  );
}

export function MailboxSendNotice({ sent, simulated, error }: { sent?: string; simulated?: string; error?: string }) {
  if (error) {
    return <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p>;
  }
  if (simulated) {
    return (
      <p className="rounded-md border-4 border-navy bg-[#d9e4ef] px-4 py-3 text-sm font-bold text-navy-deep">
        {SIMULATED_EMAIL_BANNER}. The attempt is on this file&apos;s history.
      </p>
    );
  }
  if (sent) {
    return (
      <p className="rounded-md border border-ok/40 bg-[#eef6ef] px-4 py-3 text-sm">
        Sent from {CAS_CLAIMS_MAILBOX}. The send is on this file&apos;s history.
      </p>
    );
  }
  return null;
}
