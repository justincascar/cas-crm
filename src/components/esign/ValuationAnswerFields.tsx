const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-3 text-base";

/** R66 Draft 8a: the client's answer, ticked before signing (on screen, by link or recorded from the paper copy). */
export function ValuationAnswerFields() {
  return (
    <fieldset className="space-y-3 text-base" data-valuation-answer>
      <legend className="font-semibold">Please tick one</legend>
      <label className="flex items-start gap-3">
        <input type="radio" name="choice" value="A" required className="mt-1 h-5 w-5" />
        <span>
          <strong>A.</strong> I accept the valuation. My vehicle can be released for salvage, and I will hand over the logbook (V5C) and keys.
        </span>
      </label>
      <label className="flex items-start gap-3">
        <input type="radio" name="choice" value="B" className="mt-1 h-5 w-5" />
        <span>
          <strong>B.</strong> I accept the valuation but want to keep my vehicle. I understand the salvage value will be deducted.
        </span>
      </label>
      <label className="flex items-start gap-3">
        <input type="radio" name="choice" value="C" className="mt-1 h-5 w-5" />
        <span>
          <strong>C.</strong> I do not accept the valuation because:
        </span>
      </label>
      <textarea name="reason" rows={2} maxLength={1000} className={field} placeholder="Only for C. Adverts for similar vehicles for sale around the accident date help." />
      <fieldset className="space-y-2">
        <legend>Is there any finance outstanding on the vehicle?</legend>
        <label className="mr-4 inline-flex items-center gap-2">
          <input type="radio" name="finance" value="no" required className="h-5 w-5" /> No
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="radio" name="finance" value="yes" className="h-5 w-5" /> Yes
        </label>
        <input name="lender" className={field} placeholder="Lender, if yes" />
      </fieldset>
    </fieldset>
  );
}
