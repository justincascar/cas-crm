"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { actionRecordAgreedHead, actionRecordAgreedRepair } from "@/app/chase-actions";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

const copy = {
  repairs: {
    label: "Agreed repair invoice (£)",
    hint: "This is the agreed repair figure only. It does not include storage, and it does not change the amount received.",
  },
  hire: {
    label: "Agreed hire figure (£)",
    hint: "This is the agreed hire figure only. It does not change the amount received, and it does not change a chase that is already running.",
  },
  recovery: {
    label: "Agreed recovery figure (£)",
    hint: "This is the agreed recovery figure only. It does not change the amount received, and it does not change a chase that is already running.",
  },
  storage: {
    label: "Agreed storage figure (£)",
    hint: "This is the agreed storage figure only. It does not change the amount received, and it does not change a chase that is already running.",
  },
} as const;

export function HeadAgreedForm({
  claimId,
  head,
  recordVersion = "",
}: {
  claimId: string;
  head: keyof typeof copy;
  recordVersion?: string;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const text = copy[head];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const form = new FormData();
    form.set("claimId", claimId);
    form.set("recordVersion", recordVersion);
    form.set("agreed", amount);
    if (head !== "repairs") form.set("head", head);
    const result = head === "repairs" ? await actionRecordAgreedRepair(form) : await actionRecordAgreedHead(form);
    setBusy(false);
    if ("error" in result && result.error) {
      setMessage(result.error);
      return;
    }
    setAmount("");
    router.refresh();
  }

  return (
    <form className="mt-4 grid gap-2 rounded-md border border-line bg-white p-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={submit}>
      <label className="text-sm">
        {text.label}
        <input
          name="agreed"
          inputMode="decimal"
          required
          className={field}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <span className="mt-1 block text-slate">{text.hint}</span>
      </label>
      <button className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white" type="submit" disabled={busy}>
        Record agreed figure
      </button>
      {message ? <p className="sm:col-span-2 text-sm text-overdue">{message}</p> : null}
    </form>
  );
}
