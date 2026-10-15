import type { SaveClashView } from "@/lib/db/record-version";

export function SaveClashNotice({
  clash,
  reloadHref,
}: {
  clash: SaveClashView | null;
  reloadHref: string;
}) {
  if (!clash) return null;
  const unsaved = clash.unsaved?.length
    ? clash.unsaved
    : Object.entries(clash.submitted)
        .filter(([, value]) => String(value || "").trim())
        .map(([name, value]) => ({ name, label: name, saved: "", yours: value }));
  return (
    <div className="space-y-3 rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm" role="alert">
      <p className="font-semibold text-overdue">{clash.message}</p>
      {clash.changedFields.length ? (
        <div>
          <p>{clash.actorName} changed:</p>
          <ul className="mt-1 list-disc pl-5">
            {clash.changedFields.map((field) => (
              <li key={field.name}>
                <span className="font-semibold">{field.label}</span>: {field.saved}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {unsaved.length ? (
        <div>
          <p>Your unsaved entries:</p>
          <ul className="mt-1 list-disc pl-5">
            {unsaved.map((field) => (
              <li key={field.name}>
                <span className="font-semibold">{field.label}</span>: {field.yours}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p>
        <a className="font-semibold text-teal-dark underline" href={reloadHref}>
          Reload the latest version
        </a>
      </p>
    </div>
  );
}

export function RecordVersionField({ version }: { version: string }) {
  return <input type="hidden" name="recordVersion" value={version} />;
}
