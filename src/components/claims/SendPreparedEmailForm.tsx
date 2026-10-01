"use client";

import { CAS_CLAIMS_MAILBOX } from "@/lib/constants";

export function SendPreparedEmailForm({
  claimId,
  correspondenceId,
  returnTo,
}: {
  claimId: string;
  correspondenceId: string;
  returnTo: string;
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
        Send from {CAS_CLAIMS_MAILBOX}
      </button>
    </form>
  );
}

export function MailboxSendNotice({ sent, error }: { sent?: string; error?: string }) {
  if (error) {
    return <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p>;
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
