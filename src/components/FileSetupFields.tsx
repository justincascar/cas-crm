"use client";

import { useState } from "react";
import { JURISDICTIONS } from "@/lib/domain/jurisdiction";
import {
  circumstancesSummary,
  SAFE_TO_DRIVE_CHOICES,
  SAFE_TO_DRIVE_QUESTIONS,
  suggestJurisdiction,
  suggestRoadworthiness,
  type SafeToDriveAnswers,
} from "@/lib/domain/file-setup";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

/** What the form has so far, read as the call goes on, for the suggestions in the file set-up. */
export type CallFacts = { location: string; clientPostcode: string; circumstances: string; answers: SafeToDriveAnswers };

export function readCallFacts(form: HTMLFormElement): CallFacts {
  const data = new FormData(form);
  const answers: SafeToDriveAnswers = {};
  for (const q of SAFE_TO_DRIVE_QUESTIONS) answers[q.key] = String(data.get(q.key) || "");
  return {
    location: String(data.get("location") || ""),
    clientPostcode: String(data.get("client_postcode") || ""),
    circumstances: String(data.get("circumstances") || ""),
    answers,
  };
}

export function callFactsFrom(defaults: Record<string, string>): CallFacts {
  const answers: SafeToDriveAnswers = {};
  for (const q of SAFE_TO_DRIVE_QUESTIONS) answers[q.key] = defaults[q.key] || "";
  return { location: defaults.location || "", clientPostcode: defaults.client_postcode || "", circumstances: defaults.circumstances || "", answers };
}

/** R52: "Is it safe to drive?" Yes, No or Not known for each. Nothing is chosen until staff choose. */
export function SafeToDriveQuestions({ defaults }: { defaults: Record<string, string> }) {
  return (
    <fieldset className="space-y-2 rounded-lg border border-line p-4" data-safe-to-drive>
      <legend className="px-1 font-semibold text-navy-deep">Is it safe to drive?</legend>
      <p className="text-xs text-slate">Ask each one. Any Yes suggests Unroadworthy in the file set-up below. It is a suggestion, not a certificate.</p>
      {SAFE_TO_DRIVE_QUESTIONS.map((q) => (
        <div key={q.key} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-sm first-of-type:border-t-0">
          <span>{q.label}</span>
          <span className="flex gap-1" role="radiogroup" aria-label={q.label}>
            {SAFE_TO_DRIVE_CHOICES.map((choice) => (
              <label key={choice.value} className="inline-flex min-h-10 cursor-pointer items-center gap-1 rounded-md border border-line bg-white px-3 has-[:checked]:border-navy has-[:checked]:bg-navy has-[:checked]:text-white">
                <input type="radio" name={q.key} value={choice.value} defaultChecked={defaults[q.key] === choice.value} className="sr-only" />
                {choice.label}
              </label>
            ))}
          </span>
        </div>
      ))}
    </fieldset>
  );
}

/**
 * R50: the file set-up, last. Liability is never suggested. Jurisdiction and roadworthiness follow the facts above
 * until staff choose; changing the suggested roadworthiness needs a reason. Any item can be Not yet known.
 */
export function FileSetupFields({
  staff,
  defaults,
  currentStaffId,
  facts,
  n,
}: {
  staff: Array<{ id: string; name: string }>;
  defaults: Record<string, string>;
  currentStaffId: string;
  facts: CallFacts;
  n: number;
}) {
  const jurisdictionSuggestion = suggestJurisdiction(facts.location, facts.clientPostcode);
  const roadSuggestion = suggestRoadworthiness(facts.answers);
  const [jurisdictionChosen, setJurisdictionChosen] = useState(defaults.jurisdiction || "");
  const [roadChosen, setRoadChosen] = useState<string | null>(defaults.roadworthiness !== undefined && defaults.roadworthiness !== "" ? defaults.roadworthiness : null);
  const jurisdiction = jurisdictionChosen || jurisdictionSuggestion.value;
  const roadworthiness = roadChosen ?? roadSuggestion.value;
  const changedRoad = roadChosen !== null && roadSuggestion.value !== "" && roadChosen !== roadSuggestion.value;
  const summary = circumstancesSummary(facts.circumstances);
  const handlerDefault = defaults.handlerId || (staff.some((person) => person.id === currentStaffId) ? currentStaffId : staff[0]?.id || "");

  return (
    <section className="space-y-4 rounded-xl border border-line bg-card p-5" data-file-setup>
      <h2 className="font-serif text-xl text-navy-deep">
        {n}. File set-up
      </h2>
      <p className="text-sm text-slate">
        Decided last, from the facts above. Each can be Not yet known: the claim still saves, and the file shows File set-up incomplete until
        it is decided. Chasers, the storage and recovery agreement and fault or non-fault letters wait until then.
      </p>
      <div className="space-y-1">
        <p className="text-sm" data-circumstances-summary>
          <span className="font-semibold">What happened: </span>
          {summary || "No circumstances entered yet."}
        </p>
        <label className="block max-w-sm text-sm">
          Liability status (never decided automatically)
          <select name="claimType" className={field} defaultValue={defaults.claimType || ""}>
            <option value="">Not yet known</option>
            <option value="non_fault">Non-fault</option>
            <option value="fault">Fault</option>
            <option value="disputed">Disputed / unclear</option>
          </select>
        </label>
      </div>
      <label className="block max-w-sm text-sm">
        Jurisdiction
        <select name="jurisdiction" className={field} value={jurisdiction} onChange={(event) => setJurisdictionChosen(event.target.value)}>
          {JURISDICTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-slate" data-jurisdiction-suggestion>
          Suggested: {jurisdictionSuggestion.text}.
        </span>
      </label>
      <div className="space-y-1">
        <label className="block max-w-sm text-sm">
          Roadworthiness
          <select name="roadworthiness" className={field} value={roadworthiness} onChange={(event) => setRoadChosen(event.target.value)}>
            <option value="">Not yet known</option>
            <option value="roadworthy">Roadworthy</option>
            <option value="unroadworthy">Unroadworthy</option>
          </select>
        </label>
        <p className="text-xs text-slate" data-roadworthiness-suggestion>
          Suggested: {roadSuggestion.text}.
        </p>
        <input type="hidden" name="roadworthinessSuggestion" value={roadSuggestion.text} />
        {changedRoad ? (
          <label className="block text-sm">
            Why you changed the suggestion
            <textarea name="roadworthinessChangeReason" required rows={2} className={field} defaultValue={defaults.roadworthinessChangeReason || ""} />
          </label>
        ) : null}
      </div>
      <label className="block max-w-sm text-sm">
        Handler
        <select name="handlerId" className={field} defaultValue={handlerDefault}>
          {staff.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
