import { SubmitKeyInput } from "@/components/SubmitKeyInput";
import { formatUkDateTime } from "@/lib/dates";
import { NEEDS_JUSTIN_APPROVAL, type LegalApprovalState } from "@/lib/db/legal-approval";

/** A rebuttal or impecuniosity response: Justin approves it before it is marked as sent or emailed. */
export function LegalApprovalPanel({
  documentId,
  state,
  canApprove,
}: {
  documentId: string;
  state: LegalApprovalState;
  canApprove: boolean;
}) {
  if (!state.required) return null;
  const action = `/documents/${documentId}/legal`;
  return (
    <section className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm print:hidden" data-legal-approval={state.sentAt ? "sent" : state.approvedAt ? "approved" : "needed"}>
      {state.sentAt ? (
        <p>
          Approved by {state.approvedBy || "Justin"} on {formatUkDateTime(state.approvedAt)}. Marked as sent on {formatUkDateTime(state.sentAt)}.
        </p>
      ) : state.approvedAt ? (
        <div className="flex flex-wrap items-center gap-3">
          <p>
            Approved by {state.approvedBy || "Justin"} on {formatUkDateTime(state.approvedAt)}. It can now be sent.
          </p>
          <form method="post" action={action}>
            <SubmitKeyInput />
            <input type="hidden" name="intent" value="sent" />
            <button type="submit" className="rounded-md bg-navy px-3 py-2 font-semibold text-white">
              Mark as sent
            </button>
          </form>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-semibold">{NEEDS_JUSTIN_APPROVAL}. This is a draft until he approves it.</p>
          {canApprove ? (
            <form method="post" action={action}>
              <SubmitKeyInput />
              <input type="hidden" name="intent" value="approve" />
              <button type="submit" className="rounded-md bg-navy px-3 py-2 font-semibold text-white">
                Approve for sending
              </button>
            </form>
          ) : null}
        </div>
      )}
    </section>
  );
}
