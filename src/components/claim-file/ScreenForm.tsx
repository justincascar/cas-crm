"use client";

import { useRef, useState } from "react";
import { actionSaveClaimScreen } from "@/app/actions";
import { AccidentDateField } from "@/components/AccidentDateField";
import { AccidentScenePhotosFields } from "@/components/AccidentScenePhotosFields";
import { AgeField } from "@/components/AgeField";
import { casingInputProps } from "@/components/CasedField";
import { MobileField } from "@/components/MobileField";
import { PostcodeAddressLookup } from "@/components/PostcodeAddressLookup";
import { InsurerNameField } from "@/components/InsurerNameField";
import { TpInsuranceFields } from "@/components/TpInsuranceFields";
import { TpAgentFields } from "@/components/TpAgentFields";
import { DamageDiagram } from "@/components/claim-file/DamageDiagram";
import { ValidatedForm } from "@/components/ValidatedForm";
import { dobKindForField, isDobFieldName } from "@/lib/age";
import type { ClaimScreenDef, ScreenField } from "@/lib/claim-screens";
import { displayValue } from "@/lib/screen-display";
import type { ScreenValues } from "@/lib/db/screens";
import type { KnownInsurer } from "@/lib/insurers";
import { kindForField } from "@/lib/text";
import { isMobileFieldName } from "@/lib/phone-number";

const control = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

function setNamedValue(form: HTMLFormElement | null, name: string, value: string) {
  if (!form || !name || !value) return;
  const el = form.elements.namedItem(name);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.value = value;
}

function siblingField(name: string, kind: "address" | "town"): string {
  if (name === "postcode") return kind;
  if (name.endsWith("Postcode")) return name.slice(0, -"Postcode".length) + (kind === "address" ? "Address" : "Town");
  if (name.toLowerCase().endsWith("postcode")) return name.slice(0, -"postcode".length) + kind;
  return "";
}

function PostcodeInput({ field, shown }: { field: ScreenField; shown: string }) {
  const [value, setValue] = useState(shown);
  const [address, setAddress] = useState("");
  const [town, setTown] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  function fillSiblings(line1: string, nextTown: string) {
    const form = rootRef.current?.closest("form") ?? null;
    const townName = siblingField(field.name, "town");
    const addressName = siblingField(field.name, "address");
    const townEl = form?.elements.namedItem(townName);
    if (townEl instanceof HTMLInputElement || townEl instanceof HTMLTextAreaElement) {
      setNamedValue(form, addressName, line1);
      setNamedValue(form, townName, nextTown);
      return;
    }
    setNamedValue(form, addressName, [line1, nextTown].filter(Boolean).join(", "));
  }

  return (
    <div ref={rootRef}>
      <PostcodeAddressLookup
        showAddressFields={false}
        postcodeName={field.name}
        addressName={siblingField(field.name, "address") || `${field.name}-line1`}
        townName={siblingField(field.name, "town") || `${field.name}-town`}
        postcode={value}
        address={address}
        town={town}
        onPostcode={setValue}
        onAddress={setAddress}
        onTown={setTown}
        onPicked={(picked) => fillSiblings(picked.line1, picked.town)}
      />
    </div>
  );
}

function FieldInput({
  screenKey,
  field,
  values,
}: {
  screenKey: string;
  field: ScreenField;
  values: ScreenValues;
}) {
  const raw = values[field.name] || "";
  const shown = displayValue(screenKey, field.name, raw);
  const type = field.type || "text";

  if (type === "textarea") {
    return <textarea name={field.name} rows={3} defaultValue={shown} {...casingInputProps(field.name, "textarea", control)} />;
  }
  if (type === "checkbox") {
    return (
      <input
        type="checkbox"
        name={field.name}
        value="yes"
        defaultChecked={raw === "yes"}
        className="mt-2 h-4 w-4"
      />
    );
  }
  if (type === "select") {
    return (
      <select name={field.name} className={control} defaultValue={shown}>
        {(field.options || []).map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }
  const htmlType = type === "gbp" ? "text" : type === "number" ? "number" : type;
  const casing = type === "date" || type === "time" || type === "number" || type === "gbp"
    ? { className: control }
    : casingInputProps(field.name, type, control);
  return (
    <input
      name={field.name}
      type={htmlType}
      inputMode={type === "gbp" ? "decimal" : undefined}
      step={type === "gbp" ? "0.01" : undefined}
      defaultValue={shown}
      {...casing}
    />
  );
}

function Tp2InsurerName({
  defaultValue,
  insurers,
}: {
  defaultValue: string;
  insurers: KnownInsurer[];
}) {
  const [name, setName] = useState(defaultValue);
  return (
    <InsurerNameField
      inputName="insurerName"
      value={name}
      onChange={setName}
      onPick={(insurer) => setName(insurer.name)}
      insurers={insurers}
      className={control}
    />
  );
}

export function ScreenForm({
  claimId,
  actorId,
  def,
  values,
  saved,
  clientRole,
  insurers = [],
  agents = [],
  error,
  errorField,
}: {
  claimId: string;
  actorId: string;
  def: ClaimScreenDef;
  values: ScreenValues;
  saved?: boolean;
  clientRole?: string;
  insurers?: KnownInsurer[];
  agents?: KnownInsurer[];
  error?: string;
  errorField?: string;
}) {
  return (
    <ValidatedForm
      action={actionSaveClaimScreen}
      className="space-y-6"
      initialError={error}
      initialErrorField={errorField}
    >
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="screenKey" value={def.key} />
      <input type="hidden" name="actorId" value={actorId} />

      {def.key === "damage" ? <DamageDiagram clientPanels={values.clientPanels} tpPanels={values.tpPanels} /> : null}

      {def.sections.map((section, index) => (
        <fieldset key={section.title || index} className="space-y-3 rounded-xl border border-line bg-card p-5">
          {section.title ? <legend className="font-serif text-xl text-navy-deep">{section.title}</legend> : null}
          {section.title === "TP insurance" ? (
            <TpInsuranceFields values={values} insurers={insurers} />
          ) : section.title === "TP insurer agent" ? (
            <TpAgentFields values={values} agents={agents} />
          ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {section.fields.map((field) => {
              if (field.name === "insurerName") {
                return (
                  <label key={field.name} className={`block text-sm ${field.span === 2 ? "sm:col-span-2" : ""}`}>
                    {field.label}
                    <Tp2InsurerName defaultValue={displayValue(def.key, field.name, values[field.name] || "")} insurers={insurers} />
                    {field.hint ? <span className="mt-1 block text-xs text-slate">{field.hint}</span> : null}
                  </label>
                );
              }
              if (kindForField(field.name, field.type) === "postcode") {
                return (
                  <div key={field.name} className="sm:col-span-2">
                    <PostcodeInput field={field} shown={displayValue(def.key, field.name, values[field.name] || "")} />
                  </div>
                );
              }
              if (isDobFieldName(field.name) && (field.type === "date" || !field.type)) {
                return (
                  <label key={field.name} className={`block text-sm ${field.span === 2 ? "sm:col-span-2" : ""}`}>
                    {field.label}
                    <AgeField
                      name={field.name}
                      defaultValue={(values[field.name] || "").slice(0, 10)}
                      kind={dobKindForField(def.key, field.name, clientRole)}
                    />
                    {field.hint ? <span className="mt-1 block text-xs text-slate">{field.hint}</span> : null}
                  </label>
                );
              }
              if (field.name === "accidentDate") {
                return (
                  <label key={field.name} className={`block text-sm ${field.span === 2 ? "sm:col-span-2" : ""}`}>
                    {field.label}
                    <AccidentDateField
                      name={field.name}
                      defaultValue={displayValue(def.key, field.name, values[field.name] || "")}
                    />
                    {field.hint ? <span className="mt-1 block text-xs text-slate">{field.hint}</span> : null}
                  </label>
                );
              }
              if (field.name === "photosAtScene") {
                return (
                  <AccidentScenePhotosFields
                    key={field.name}
                    claimId={claimId}
                    defaultValue={values.photosAtScene || ""}
                  />
                );
              }
              if (isMobileFieldName(field.name)) {
                return (
                  <label key={field.name} className={`block text-sm ${field.span === 2 ? "sm:col-span-2" : ""}`}>
                    {field.label}
                    <MobileField name={field.name} defaultValue={displayValue(def.key, field.name, values[field.name] || "")} />
                    {field.hint ? <span className="mt-1 block text-xs text-slate">{field.hint}</span> : null}
                  </label>
                );
              }
              return (
                <label key={field.name} className={`block text-sm ${field.span === 2 ? "sm:col-span-2" : ""}`}>
                  {field.label}
                  <FieldInput screenKey={def.key} field={field} values={values} />
                  {field.name === "audatexNetworkCode" && values.audatexNetworkCodeSuggestedFrom ? (
                    <span className="mt-1 block rounded-md border border-warn/40 bg-[#fff6e8] px-2 py-1 text-xs text-navy">
                      Suggested from {values.audatexNetworkCodeSuggestedFrom}. Not yet confirmed on this file.
                    </span>
                  ) : null}
                  {field.name === "audatexWorkProviderCode" && values.audatexWorkProviderCodeSuggestedFrom ? (
                    <span className="mt-1 block rounded-md border border-warn/40 bg-[#fff6e8] px-2 py-1 text-xs text-navy">
                      Suggested from {values.audatexWorkProviderCodeSuggestedFrom}. Not yet confirmed on this file.
                    </span>
                  ) : null}
                  {field.hint ? <span className="mt-1 block text-xs text-slate">{field.hint}</span> : null}
                </label>
              );
            })}
          </div>
          )}
        </fieldset>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm text-white">
          Save this screen
        </button>
        {saved ? <p className="text-sm text-ok">Saved.</p> : null}
      </div>
    </ValidatedForm>
  );
}
