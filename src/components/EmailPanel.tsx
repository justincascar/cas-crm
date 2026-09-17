"use client";

import { useState } from "react";
import { actionSendEmail } from "@/app/actions";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export function EmailPanel({ claimId, handlerId }: { claimId: string; handlerId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <form
      className="grid gap-2 rounded-lg border border-dashed border-copper/40 bg-[#fbf6ec] p-4 md:grid-cols-2"
      action={async (formData) => {
        const result = await actionSendEmail(formData);
        if (result.ok) setMessage(result.warning);
        else setMessage(result.error);
      }}
    >
      <h3 className="font-serif text-lg text-navy-deep md:col-span-2">Send email (prototype)</h3>
      <p className="text-xs text-slate md:col-span-2">
        This records the email on the file history. It does not leave this computer until CAS's mailbox is connected.
        A click is not proof of delivery.
      </p>
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="actorId" value={handlerId} />
      <label className="text-sm">
        To
        <input name="to" required placeholder="insurer@example.com" className={field} />
      </label>
      <label className="text-sm">
        Date of sending
        <input name="occurredAt" type="datetime-local" className={field} />
      </label>
      <label className="text-sm md:col-span-2">
        Subject
        <input name="subject" required placeholder="Our ref: TEST-0003  Your policy: …" className={field} />
      </label>
      <label className="text-sm md:col-span-2">
        Body
        <textarea name="body" required rows={5} className={field} defaultValue={"Dear Sir / Madam\n\n"} />
      </label>
      <button className="rounded-md bg-navy px-3 py-2 text-sm text-white" type="submit">
        Record outgoing email
      </button>
      {message ? <p className="text-sm text-copper md:col-span-2">{message}</p> : null}
    </form>
  );
}
