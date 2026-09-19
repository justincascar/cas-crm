"use client";

import { useMemo, useState } from "react";
import { actionGenerateDocument, actionPreviewCorrespondence } from "@/app/actions";
import { DOCUMENT_TEMPLATES } from "@/lib/documents/catalog";
import { letterSuggestionNote, suggestedLetterTemplateKey } from "@/lib/documents/notification-letters";
import { ValidatedForm } from "@/components/ValidatedForm";
import Link from "next/link";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export function DocumentGenerateForm({
  claimId,
  handlerId,
  liabilityStatus,
  variant = "comms",
}: {
  claimId: string;
  handlerId: string;
  liabilityStatus: string;
  variant?: "comms" | "history";
}) {
  const suggested = suggestedLetterTemplateKey(liabilityStatus);
  const [templateKey, setTemplateKey] = useState(suggested || "");
  const [preview, setPreview] = useState<{
    subject: string;
    body: string;
    html: string;
    missing: string[];
    legalSignOffRequired: boolean;
    error?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const options = useMemo(() => {
    return DOCUMENT_TEMPLATES.map((item) => ({
      ...item,
      suggested: item.key === suggested,
    }));
  }, [suggested]);

  async function previewLetter() {
    if (!templateKey) {
      setPreview({
        subject: "",
        body: "",
        html: "",
        missing: [],
        legalSignOffRequired: false,
        error: "Pick a document first.",
      });
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.set("claimId", claimId);
    form.set("templateKey", templateKey);
    const result = await actionPreviewCorrespondence(form);
    setPreview({
      subject: result.subject,
      body: result.body,
      html: "html" in result ? result.html || "" : "",
      missing: result.missing,
      legalSignOffRequired: result.legalSignOffRequired,
      error: "error" in result ? result.error : undefined,
    });
    setBusy(false);
  }

  const boxClass =
    variant === "comms"
      ? "grid gap-3 rounded-xl border-2 border-teal bg-[#e8f4f2] p-5 md:grid-cols-2"
      : "space-y-2 rounded-lg border border-line p-4";

  return (
    <ValidatedForm action={actionGenerateDocument} className={boxClass}>
      <h2 className={`font-serif text-xl text-navy-deep ${variant === "comms" ? "md:col-span-2" : ""}`}>
        {variant === "comms" ? "Generate a document" : "Create a document from the dates"}
      </h2>
      <p className={`text-sm text-slate ${variant === "comms" ? "md:col-span-2" : "text-xs"}`}>
        Letters are built from facts already on this file. Missing items are marked as [not yet on file], not invented.
        Preview first. Generating files the letter on this claim — it does not send it. Hire Pack is a separate pack.
      </p>
      <p className={`text-sm text-navy-deep ${variant === "comms" ? "md:col-span-2" : ""}`}>{letterSuggestionNote(liabilityStatus)}</p>
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="actorId" value={handlerId} />
      <label className="text-sm">
        Document
        <select
          name="templateKey"
          className={field}
          value={templateKey}
          onChange={(event) => {
            setTemplateKey(event.target.value);
            setPreview(null);
          }}
        >
          <option value="">Choose a document</option>
          {options.map((item) => (
            <option key={item.key} value={item.key}>
              {item.suggested ? "Suggested: " : ""}
              {item.channel === "email" ? `Email: ${item.title}` : item.title}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Letter date
        <input name="letterDate" type="date" className={field} />
      </label>
      <label className={`flex items-center gap-2 text-sm ${variant === "comms" ? "md:col-span-2" : ""}`}>
        <input name="recordOnFile" type="checkbox" value="yes" />
        Also record this as a dated step on the file (still not sent)
      </label>
      <div className={`flex flex-wrap gap-2 ${variant === "comms" ? "md:col-span-2" : ""}`}>
        <button
          className="rounded-md border border-line bg-white px-4 py-2 text-sm"
          type="button"
          disabled={busy}
          onClick={() => void previewLetter()}
        >
          Preview
        </button>
        <button className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white" type="submit" disabled={!templateKey}>
          Generate and open
        </button>
        {variant === "comms" ? (
          <Link href={`/claims/${claimId}/hire-pack`} className="self-center text-sm font-semibold text-teal-dark underline">
            Open Hire Pack
          </Link>
        ) : null}
      </div>
      {preview ? (
        <div className={`space-y-3 ${variant === "comms" ? "md:col-span-2" : ""}`}>
          {preview.error ? <p className="text-sm text-copper">{preview.error}</p> : null}
          {preview.missing.length > 0 ? (
            <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">
              Missing from the file — marked in the letter as [not yet on file], not left blank: {preview.missing.join(", ")}.
            </p>
          ) : preview.subject ? (
            <p className="rounded-md border border-ok/40 bg-[#eef6ef] px-4 py-3 text-sm">
              All listed fields for this letter are on the file. Generating will file a copy. It will not send it.
            </p>
          ) : null}
          {preview.legalSignOffRequired ? (
            <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">
              Legal wording needs solicitor sign-off before it is used live.
            </p>
          ) : null}
          {preview.html ? (
            <div className="letter-paper rounded-xl border border-line bg-card p-8" dangerouslySetInnerHTML={{ __html: preview.html }} />
          ) : preview.body ? (
            <pre className="whitespace-pre-wrap rounded-xl border border-line bg-white p-4 text-sm">{preview.body}</pre>
          ) : null}
        </div>
      ) : null}
    </ValidatedForm>
  );
}
