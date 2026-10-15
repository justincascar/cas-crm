"use client";

import { useRef } from "react";

export function SeparateRecordConfirm({
  message,
  action,
  fields,
  confirmField,
  cancelHref,
}: {
  message: string;
  action: string;
  fields: Record<string, string>;
  confirmField: string;
  cancelHref: string;
}) {
  const key = useRef("");
  if (!key.current) key.current = crypto.randomUUID();
  if (!message) return null;
  return (
    <div className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm" role="alert">
      <p>{message}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <form method="post" action={action}>
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <input type="hidden" name="submitKey" value={key.current} />
          <input type="hidden" name={confirmField} value="yes" />
          <button className="min-h-11 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white" type="submit">
            Yes
          </button>
        </form>
        <a className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold" href={cancelHref}>
          Cancel
        </a>
      </div>
    </div>
  );
}
