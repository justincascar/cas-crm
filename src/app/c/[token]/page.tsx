import { ValidatedForm } from "@/components/ValidatedForm";
import { CarDamageDiagram } from "@/components/CarDamageDiagram";
import type { Metadata } from "next";
import { formatUkDateTime } from "@/lib/dates";
import { CLIENT_FORM_FIELDS, CLIENT_UPLOAD_KINDS, clientFormView } from "@/lib/db/client-form";

// The link is the client's key: keep it out of search engines and out of the Referer header.
export const metadata: Metadata = { title: "Your claim details", robots: { index: false, follow: false }, referrer: "no-referrer" };

const box = "mt-1 block w-full rounded-md border border-line bg-white px-3 py-3 text-base";
const autocomplete: Record<string, string> = { mobile: "tel", email: "email", address: "street-address", postcode: "postal-code" };
const inputType: Record<string, string> = { mobile: "tel", email: "email" };

export default async function ClientFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; saved?: string; sent?: string; added?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  let view: ReturnType<typeof clientFormView> | null = null;
  let refusal = "";
  try {
    view = clientFormView(token);
  } catch (problem) {
    refusal = problem instanceof Error ? problem.message : "This link cannot be used.";
  }
  if (!view) {
    return (
      <main className="mx-auto max-w-xl space-y-4 px-4 py-8">
        <h1 className="font-serif text-2xl text-navy-deep">Your claim details</h1>
        <p className="text-base" data-client-refused>
          {refusal}
        </p>
      </main>
    );
  }
  const sections = [...new Set(CLIENT_FORM_FIELDS.map((field) => field.section))];
  const sent = view.status === "submitted";
  return (
    <main className="mx-auto max-w-xl space-y-5 px-4 py-6" data-client-form>
      <div>
        <p className="text-sm text-slate">Complete Accident Solutions Ltd · {view.fileReference}</p>
        <h1 className="font-serif text-2xl text-navy-deep">{view.firstName ? `Hello ${view.firstName}` : "Your claim details"}</h1>
        <p className="mt-1 text-base">
          Please fill in what you can and add photos of the damage and your papers. You can save and come back to this page at any time using the same link.
        </p>
      </div>

      {query.error ? (
        <p data-form-error role="alert" className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-base text-overdue">
          {query.error}
        </p>
      ) : null}
      {query.sent ? (
        <p data-client-sent role="status" className="rounded-md border border-teal/40 bg-[#eef8f6] px-4 py-3 text-base">
          Thank you. Your details have been sent to Complete Accident Solutions. We check them before updating your claim. You can still change or add something below.
        </p>
      ) : query.saved ? (
        <p data-client-saved role="status" className="rounded-md border border-teal/40 bg-[#eef8f6] px-4 py-3 text-base">
          {query.added ? "Your file has been added and your answers saved." : "Saved. You can come back to this page using the same link."}
          {sent ? "" : " When you have finished, press Send to CAS at the bottom."}
        </p>
      ) : null}

      {view.stillNeeded.length ? (
        // One short paragraph, so on a phone the form starts on the first screen.
        <p className="rounded-xl border border-line bg-card px-4 py-3 text-base" data-client-still-needed>
          <span className="font-semibold text-navy-deep">Still needed from you: </span>
          {view.stillNeeded.join(", ")}.
        </p>
      ) : null}

      <ValidatedForm method="post" action={`/c/${token}/save`} encType="multipart/form-data" className="space-y-5">
        {sections.map((section) => (
          <fieldset key={section} className="space-y-4 rounded-xl border border-line bg-card p-4">
            <legend className="px-1 text-lg font-semibold text-navy-deep">{section}</legend>
            {CLIENT_FORM_FIELDS.filter((field) => field.section === section).map((field) => (
              <label key={field.name} className="block text-base font-medium">
                {field.label}
                {field.name === "damageZones" ? (
                  <div className="mt-2">
                    <CarDamageDiagram name="damageZones" initial={view.values.damageZones || ""} />
                  </div>
                ) : "long" in field && field.long ? (
                  <textarea name={field.name} defaultValue={view.values[field.name] || ""} rows={4} autoComplete={autocomplete[field.name]} className={box} />
                ) : (
                  <input
                    name={field.name}
                    type={inputType[field.name] || "text"}
                    defaultValue={view.values[field.name] || ""}
                    autoComplete={autocomplete[field.name] || "off"}
                    className={box}
                  />
                )}
              </label>
            ))}
          </fieldset>
        ))}

        <fieldset className="space-y-4 rounded-xl border border-line bg-card p-4" id="files">
          <legend className="px-1 text-lg font-semibold text-navy-deep">Photos and papers</legend>
          <p className="text-base">Add one photo or PDF at a time, up to 12 MB each. Choose what it is first.</p>
          <label className="block text-base font-medium">
            What is it?
            <select name="kind" defaultValue="photo" className={box}>
              {CLIENT_UPLOAD_KINDS.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-base font-medium">
            Photo or PDF
            <input
              name="file"
              type="file"
              accept="image/*,application/pdf"
              className="mt-1 block w-full text-base file:mr-3 file:min-h-12 file:rounded-md file:border file:border-solid file:border-navy file:bg-white file:px-4 file:py-2 file:text-base file:font-semibold file:text-navy"
            />
          </label>
          <button type="submit" name="intent" value="add" className="min-h-12 w-full rounded-md border border-navy bg-white px-4 py-3 text-base font-semibold text-navy">
            Add this file
          </button>
          {query.added ? (
            <p role="status" className="rounded-md border border-teal/40 bg-[#eef8f6] px-3 py-2 text-base" data-client-added>
              Added. You can add another, or carry on below.
            </p>
          ) : null}
          {view.uploads.length ? (
            <div data-client-uploads>
              <p className="text-base font-medium">You have added:</p>
              <ul className="mt-1 space-y-1 text-base">
                {view.uploads.map((upload) => (
                  <li key={upload.id} className="break-words">
                    {CLIENT_UPLOAD_KINDS.find((kind) => kind.value === upload.kind)?.label || "File"}: {upload.filename}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </fieldset>

        <div className="space-y-3">
          <button type="submit" name="intent" value="save" className="min-h-12 w-full rounded-md border border-navy bg-white px-4 py-3 text-base font-semibold text-navy">
            Save and come back later
          </button>
          <button type="submit" name="intent" value="send" className="min-h-12 w-full rounded-md bg-navy px-4 py-3 text-base font-semibold text-white">
            {sent ? "Send my changes to CAS" : "Send to CAS"}
          </button>
          {view.savedAt ? <p className="text-sm text-slate">Last saved {formatUkDateTime(view.savedAt)}.</p> : null}
          <p className="text-sm text-slate">This page only shows what you have entered. Complete Accident Solutions checks everything before it changes your claim.</p>
          <p className="text-sm">
            <a href="/privacy" className="text-teal-dark underline" data-privacy-link>
              Privacy notice
            </a>
          </p>
        </div>
      </ValidatedForm>
    </main>
  );
}
