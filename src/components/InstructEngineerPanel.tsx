"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  actionInstructEngineer,
  actionMarkEngineerInstructionSent,
  actionPreviewCorrespondence,
  actionSetClaimEngineer,
} from "@/app/actions";
import { CAS_CLAIMS_MAILBOX } from "@/lib/constants";
import { formatUkDateTime } from "@/lib/dates";
import type { Engineer } from "@/lib/db/engineers";
import { buildMailtoHref } from "@/lib/email/mailto";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

type PreparedInstruction = {
  id: string;
  subject: string | null;
  to_address: string | null;
  body: string | null;
  created_at: string;
};

export function InstructEngineerPanel({
  claimId,
  engineers,
  selectedEngineerId,
  prepared,
}: {
  claimId: string;
  engineers: Engineer[];
  selectedEngineerId: string;
  prepared: PreparedInstruction | null;
}) {
  const router = useRouter();
  const [engineerId, setEngineerId] = useState(selectedEngineerId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ html: string; missing: string[]; subject: string } | null>(null);
  const [mailto, setMailto] = useState<string | null>(() =>
    prepared?.to_address && prepared.body
      ? buildMailtoHref(prepared.to_address, prepared.subject || "Engineer instruction", prepared.body)
      : null,
  );
  const [preparedId, setPreparedId] = useState(prepared?.id || "");
  const [toAddress, setToAddress] = useState(prepared?.to_address || "");

  const selected = engineers.find((row) => row.id === engineerId);

  async function saveEngineer(id: string) {
    const form = new FormData();
    form.set("claimId", claimId);
    form.set("engineerId", id);
    const result = await actionSetClaimEngineer(form);
    if (result.error) setMessage(result.error);
  }

  async function previewLetter() {
    if (!engineerId) {
      setMessage("Pick an engineer from the list first.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const form = new FormData();
    form.set("claimId", claimId);
    form.set("templateKey", "engineer_instruction");
    form.set("engineerId", engineerId);
    const result = await actionPreviewCorrespondence(form);
    setPreview({ html: result.html, missing: result.missing, subject: result.subject });
    if (result.error) setMessage(result.error);
    setBusy(false);
  }

  async function instruct() {
    if (!engineerId) {
      setMessage("Pick an engineer from the list first.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const form = new FormData();
    form.set("claimId", claimId);
    form.set("engineerId", engineerId);
    const result = await actionInstructEngineer(form);
    setBusy(false);
    if (result.error || !("mailto" in result) || !result.mailto) {
      setMessage(result.error || "Could not prepare the engineer instruction.");
      return;
    }
    setMailto(result.mailto);
    setPreparedId(result.correspondenceId);
    setToAddress(result.to);
    setPreview({ html: result.letter.html, missing: result.letter.missing, subject: result.subject });
    window.location.href = result.mailto;
    router.refresh();
  }

  async function markSent() {
    if (!preparedId) {
      setMessage("Prepare the instruction first, then mark it as sent after you have sent the email.");
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.set("claimId", claimId);
    form.set("correspondenceId", preparedId);
    const result = await actionMarkEngineerInstructionSent(form);
    setBusy(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setMessage(`Marked as sent by ${result.handlerName}. It is now on the file history. Not auto-sent from ${CAS_CLAIMS_MAILBOX}.`);
    setMailto(null);
    setPreparedId("");
    router.refresh();
  }

  return (
    <section className="rounded-xl border-2 border-teal bg-[#e8f4f2] p-5">
      <h2 className="font-serif text-xl text-navy-deep">Instruct engineer</h2>
      <p className="mt-2 text-sm text-slate">
        Pick a saved engineer. Instruct Engineer generates the letter and opens a ready-to-send email in your own
        email client. It is <strong>prepared, not auto-sent</strong>. Genuine sending from {CAS_CLAIMS_MAILBOX} is not
        connected yet.
      </p>

      {engineers.length === 0 ? (
        <p className="mt-3 text-sm">
          No engineers are on the list yet.{" "}
          <Link className="font-semibold text-teal-dark underline" href="/settings/engineers">
            Add an engineer
          </Link>
          .
        </p>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            Engineer
            <select
              className={field}
              value={engineerId}
              onChange={(event) => {
                const id = event.target.value;
                setEngineerId(id);
                setPreview(null);
                setMailto(null);
                setMessage(null);
                void saveEngineer(id);
              }}
            >
              <option value="">Choose an engineer</option>
              {engineers.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm">
            <p className="text-slate">Address and email (from the saved list)</p>
            {selected ? (
              <p className="mt-1 whitespace-pre-wrap rounded-md border border-line bg-white px-3 py-2">
                {selected.address}
                {"\n"}
                {selected.email}
              </p>
            ) : (
              <p className="mt-1 text-slate">Select an engineer to fill name, address and email.</p>
            )}
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-slate">
        More engineers can be added under{" "}
        <Link className="text-teal-dark underline" href="/settings/engineers">
          Settings → Engineers
        </Link>
        .
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md border border-line bg-white px-4 py-2 text-sm"
          disabled={busy || !engineerId}
          onClick={() => void previewLetter()}
        >
          Preview letter
        </button>
        <button
          type="button"
          className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white"
          disabled={busy || !engineerId}
          onClick={() => void instruct()}
        >
          Instruct Engineer
        </button>
        {mailto ? (
          <a className="rounded-md border border-teal bg-white px-4 py-2 text-sm font-semibold text-teal-dark" href={mailto}>
            Open pre-filled email
          </a>
        ) : null}
      </div>

      {mailto ? (
        <p className="mt-3 rounded-md border border-ok/40 bg-[#eef6ef] px-4 py-3 text-sm">
          A pre-filled email to <strong>{toAddress}</strong> is ready in your email client. After you click send there,
          mark it as sent on this file. The CRM has not sent it from {CAS_CLAIMS_MAILBOX}.
        </p>
      ) : prepared && preparedId ? (
        <p className="mt-3 rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">
          An instruction was prepared {formatUkDateTime(prepared.created_at)} for {prepared.to_address}. Open the email
          from your client if you still need to send it, then mark it as sent.
        </p>
      ) : null}

      {preparedId ? (
        <div className="mt-3">
          <button
            type="button"
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white"
            disabled={busy}
            onClick={() => void markSent()}
          >
            Mark as sent
          </button>
        </div>
      ) : null}

      {message ? <p className="mt-3 text-sm">{message}</p> : null}

      {preview ? (
        <div className="mt-4 space-y-3">
          {preview.missing.length > 0 ? (
            <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">
              Missing from the file — marked as [not yet on file], not invented: {preview.missing.join(", ")}.
            </p>
          ) : (
            <p className="rounded-md border border-ok/40 bg-[#eef6ef] px-4 py-3 text-sm">
              Engineer name and address are taken from the saved list. Generating files a copy. It does not send the
              email until you send it yourself and mark it as sent.
            </p>
          )}
          {preview.html ? (
            <div className="letter-paper rounded-xl border border-line bg-card p-8" dangerouslySetInnerHTML={{ __html: preview.html }} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
