"use client";

import type { FieldProblem } from "@/lib/form-validation";
import { FuelSelect } from "@/components/FuelSelect";
import { normaliseFuel } from "@/lib/domain/fuel";
import { CarDamageDiagram } from "@/components/CarDamageDiagram";
import { callFactsFrom, FileSetupFields, readCallFacts, SafeToDriveQuestions, type CallFacts } from "@/components/FileSetupFields";
import { useEffect, useMemo, useRef, useState } from "react";
import { restoreDraftBoxes } from "@/lib/form-restore";
import {
  actionCreateClaim,
  actionLookupCompliance,
  actionLookupVehicle,
} from "@/app/actions";
import { AccidentDateField } from "@/components/AccidentDateField";
import { AgeField } from "@/components/AgeField";
import { casingInputProps } from "@/components/CasedField";
import { MobileField } from "@/components/MobileField";
import { PostcodeAddressLookup } from "@/components/PostcodeAddressLookup";
import { InsurerNameField } from "@/components/InsurerNameField";
import { ValidatedForm } from "@/components/ValidatedForm";
import type { DobKind } from "@/lib/age";
import { mergeInsurerDetails, type KnownInsurer } from "@/lib/insurers";
import { clientDobKind, counterpartDobKind } from "@/lib/age";
import { ASK_MID_URL, GOV_MOT_URL, GOV_TAX_URL } from "@/lib/lookups/compliance";
import { googleMapsSearchUrl } from "@/lib/lookups/maps";
import { JOURNEY_OPTIONS, LIGHTING_OPTIONS, ROAD_SURFACE_OPTIONS, WEATHER_OPTIONS } from "@/lib/domain/intake-choices";
import { RecoveryFeeFields } from "@/components/claims/RecoveryFeeFields";
import { LOOKUP_NOT_CONNECTED } from "@/lib/lookups/not-connected";
import { VEHICLE_MANUAL_HINT } from "@/lib/lookups/vehicle";
import {
  formatVehicleRegistration,
  formatVehicleRegistrationLive,
  toStartCase,
  toStartCaseLive,
} from "@/lib/text";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";
const TITLES = ["", "Mr", "Mrs", "Miss", "Master"] as const;

type Staff = { id: string; name: string };

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-line bg-card p-5">
      <h2 className="font-serif text-xl text-navy-deep">
        {n}. {title}
      </h2>
      {children}
    </section>
  );
}

function PersonFields({ prefix, skipOther, kind }: { prefix: string; skipOther?: boolean; kind: DobKind }) {
  const [postcode, setPostcode] = useState("");
  const [address, setAddress] = useState("");
  const [town, setTown] = useState("");
  const [skip, setSkip] = useState(false);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">
        Title
        <select name={`${prefix}title`} className={field} defaultValue="">
          {TITLES.map((t) => (
            <option key={t || "blank"} value={t}>
              {t || "Leave blank"}
            </option>
          ))}
        </select>
      </label>
      <span />
      <label className="block text-sm">
        Forename
        <input
          name={`${prefix}forename`}
          required={prefix === "client_"}
          {...casingInputProps(`${prefix}forename`, "text", field)}
        />
      </label>
      <label className="block text-sm">
        Surname
        <input
          name={`${prefix}surname`}
          required={prefix === "client_"}
          {...casingInputProps(`${prefix}surname`, "text", field)}
        />
      </label>
      <PostcodeAddressLookup
        postcodeName={`${prefix}postcode`}
        addressName={`${prefix}address`}
        townName={`${prefix}town`}
        postcode={postcode}
        address={address}
        town={town}
        onPostcode={setPostcode}
        onAddress={setAddress}
        onTown={setTown}
      />
      {prefix === "client_" || prefix.startsWith("counterpart") ? (
        <label className="block text-sm">
          Mobile
          <MobileField name={`${prefix}mobile`} className={field} />
        </label>
      ) : (
        <label className="block text-sm">
          Telephone
          <MobileField name={`${prefix}telephone`} className={field} />
        </label>
      )}
      {skipOther ? (
        <>
          {skip ? (
            <p className="text-sm text-slate sm:col-span-2">No other number. Nothing is stored for it.</p>
          ) : (
            <label className="block text-sm">
              Other telephone
              <MobileField name={`${prefix}otherTel`} className={field} />
            </label>
          )}
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              name={`${prefix}skipOtherTel`}
              type="checkbox"
              value="yes"
              checked={skip}
              onChange={(e) => setSkip(e.target.checked)}
            />
            Skip other number
          </label>
        </>
      ) : null}
      {prefix === "client_" ? (
        <>
          <label className="block text-sm">
            Email
            <input name={`${prefix}email`} type="email" {...casingInputProps(`${prefix}email`, "email", field)} />
          </label>
          <label className="block text-sm">
            Date of birth
            <AgeField name={`${prefix}dob`} kind={kind} className={field} />
          </label>
        </>
      ) : prefix.startsWith("counterpart") ? (
        <>
          <label className="block text-sm">
            Email
            <input name={`${prefix}email`} type="email" {...casingInputProps(`${prefix}email`, "email", field)} />
          </label>
          <label className="block text-sm">
            Date of birth
            <AgeField name={`${prefix}dob`} kind={kind} className={field} />
          </label>
        </>
      ) : null}
    </div>
  );
}

/** R53: the lookup's tax or MOT wording as Yes, No or Not known. */
function yesNoFromLookup(text: string): string {
  const t = String(text || "").toLowerCase();
  if (/untaxed|sorn|not taxed|expired|no mot|invalid|fail|no\b/.test(t)) return "No";
  if (/taxed|valid|current|in date|pass|yes/.test(t)) return "Yes";
  return "";
}

function YesNoNotKnown({ name, label, value, onChange }: { name: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm">
      {label}
      <select name={name} className={field} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not known</option>
        <option value="Yes">Yes</option>
        <option value="No">No</option>
      </select>
    </label>
  );
}

function VehicleFields({
  prefix,
  matchLabel,
  thirdParty = false,
}: {
  prefix: string;
  matchLabel: string;
  /** R53: only registration, make, model, colour, taxed and MOT. Gearbox and fuel are not needed for the other vehicle. */
  thirdParty?: boolean;
}) {
  const [reg, setReg] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [colour, setColour] = useState("");
  const [fuel, setFuel] = useState("");
  const [gearbox, setGearbox] = useState("unknown");
  const [taxStatus, setTaxStatus] = useState("");
  const [motStatus, setMotStatus] = useState("");
  const [insuranceStatus, setInsuranceStatus] = useState("");
  const [incomplete, setIncomplete] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function lookupVehicle() {
    try {
      const res = await actionLookupVehicle(reg);
      const v = res.result;
      if (!v) {
        setWarnings([VEHICLE_MANUAL_HINT]);
        setIncomplete(true);
        return;
      }
      if (v.registration) setReg(formatVehicleRegistration(v.registration));
      if (v.make) setMake(toStartCase(v.make));
      if (v.model) setModel(toStartCase(v.model));
      if (v.colour) setColour(toStartCase(v.colour));
      if (v.fuel) setFuel(normaliseFuel(v.fuel));
      if (v.transmission) setGearbox(v.transmission);
      setIncomplete(true);
      setWarnings(v.warnings.length ? v.warnings : [VEHICLE_MANUAL_HINT]);
    } catch {
      setIncomplete(true);
      setWarnings([VEHICLE_MANUAL_HINT]);
    }
  }

  async function checkCompliance() {
    const res = await actionLookupCompliance(reg);
    setTaxStatus(thirdParty ? yesNoFromLookup(res.result.taxStatus) : res.result.taxStatus);
    setMotStatus(thirdParty ? yesNoFromLookup(res.result.motStatus) : res.result.motStatus);
    setInsuranceStatus(res.result.insuranceStatus);
    setWarnings(res.result.warnings);
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm">
        VRM
        <div className="mt-1 flex flex-wrap gap-2">
          <input
            name={`${prefix}registration`}
            value={reg}
            onChange={(e) => setReg(formatVehicleRegistrationLive(e.target.value))}
            onBlur={() => setReg(formatVehicleRegistration(reg))}
            className={field + " !mt-0 max-w-xs uppercase"}
          />
          <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={lookupVehicle}>
            Search vehicle
          </button>
          <p className="w-full text-xs text-slate">{LOOKUP_NOT_CONNECTED}</p>
          <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={checkCompliance}>
            Check tax, MOT and insurance
          </button>
        </div>
      </label>
      <input type="hidden" name={`${prefix}lookupIncomplete`} value={incomplete ? "yes" : ""} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-sm">
          Make
          <input
            name={`${prefix}make`}
            value={make}
            onChange={(e) => setMake(toStartCaseLive(e.target.value))}
            onBlur={() => setMake(toStartCase(make))}
            className={field}
          />
        </label>
        <label className="block text-sm">
          Model
          <input
            name={`${prefix}model`}
            value={model}
            onChange={(e) => setModel(toStartCaseLive(e.target.value))}
            onBlur={() => setModel(toStartCase(model))}
            className={field}
          />
        </label>
        <label className="block text-sm">
          Colour
          <input
            name={`${prefix}colour`}
            value={colour}
            onChange={(e) => setColour(toStartCaseLive(e.target.value))}
            onBlur={() => setColour(toStartCase(colour))}
            className={field}
          />
        </label>
        {thirdParty ? null : (
        <label className="block text-sm">
          Gearbox
          <select name={`${prefix}gearbox`} className={field} value={gearbox} onChange={(e) => setGearbox(e.target.value)}>
            <option value="unknown">Not known</option>
            <option value="manual">Manual</option>
            <option value="automatic">Automatic</option>
          </select>
        </label>
        )}
        {thirdParty ? null : (
        <label className="block text-sm">
          Fuel
          <FuelSelect name={`${prefix}fuel`} value={fuel} onChange={setFuel} className={field} />
        </label>
        )}
        {thirdParty ? (
          <>
            <YesNoNotKnown name={`${prefix}taxStatus`} label="Taxed?" value={taxStatus} onChange={setTaxStatus} />
            <YesNoNotKnown name={`${prefix}motStatus`} label="MOT?" value={motStatus} onChange={setMotStatus} />
          </>
        ) : (
        <>
        <label className="block text-sm">
          Tax
          <input
            name={`${prefix}taxStatus`}
            value={taxStatus}
            onChange={(e) => setTaxStatus(toStartCaseLive(e.target.value))}
            onBlur={() => setTaxStatus(toStartCase(taxStatus))}
            className={field}
          />
        </label>
        <label className="block text-sm">
          MOT
          <input
            name={`${prefix}motStatus`}
            value={motStatus}
            onChange={(e) => setMotStatus(toStartCaseLive(e.target.value))}
            onBlur={() => setMotStatus(toStartCase(motStatus))}
            className={field}
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          Insurance (record authorised result)
          <input
            name={`${prefix}insuranceStatus`}
            value={insuranceStatus}
            onChange={(e) => setInsuranceStatus(toStartCaseLive(e.target.value))}
            onBlur={() => setInsuranceStatus(toStartCase(insuranceStatus))}
            className={field}
          />
        </label>
        </>
        )}
      </div>
      <p className="text-xs text-slate">
        {VEHICLE_MANUAL_HINT} Transmission is never filled in unless the lookup actually returned it. Confirm tax/MOT
        on{" "}
        <a className="text-teal-dark underline" href={GOV_TAX_URL} target="_blank" rel="noreferrer">
          GOV.UK tax
        </a>{" "}
        and{" "}
        <a className="text-teal-dark underline" href={GOV_MOT_URL} target="_blank" rel="noreferrer">
          MOT history
        </a>
        . Insurance: use authorised{" "}
        <a className="text-teal-dark underline" href={ASK_MID_URL} target="_blank" rel="noreferrer">
          AskMID
        </a>{" "}
        then type the result here. The CRM does not scrape MID.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input name={`${prefix}detailsMatch`} type="checkbox" value="yes" />
        {matchLabel}
      </label>
      {warnings.length > 0 ? (
        <ul className="rounded-md border border-warn/40 bg-[#fff6e8] px-3 py-2 text-xs text-ink">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * R53: the MID check sits with the third party's vehicle. The first third party keeps the full askMID record; the
 * others record the insurer the check named. "Use this insurer" fills the insurer fields only when staff press it, and
 * only while no insurer is entered, so it never overwrites one.
 */
function MidCheck({ prefix, insurerEntered, onUse }: { prefix: string; insurerEntered: boolean; onUse: (name: string) => void }) {
  const [midName, setMidName] = useState("");
  const first = prefix === "tp1_";
  return (
    <div className="space-y-3 rounded-md border border-dashed border-line p-3" data-mid-check={prefix}>
      <h4 className="font-serif text-base text-navy-deep">Insurance (MID) check</h4>
      {first ? (
          <>
            <p className="text-sm text-slate">Lookup not connected yet – please type the details. This records a manual askMID check. It does not look the vehicle up.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                Date checked
                <input name="midCheckedOn" type="date" className={field} />
              </label>
              <label className="block text-sm">
                Accident date searched
                <input name="midAccidentOn" type="date" className={field} />
              </label>
              <label className="block text-sm">
                Registration searched
                <input name="midRegistration" className={field} />
              </label>
              <label className="block text-sm">
                Result
                <select name="midResult" className={field} defaultValue="">
                  <option value="">Not recorded</option>
                  <option value="insurer">Insurer found</option>
                  <option value="no_record">No record found</option>
                </select>
              </label>
              <label className="block text-sm">
                Insurer
                <input name="midInsurerName" className={field} onChange={(e) => setMidName(e.target.value)} />
              </label>
              <label className="block text-sm">
                Policy number
                <input name="midPolicy" className={field} />
              </label>
            </div>
          </>
      ) : (
        <label className="block text-sm">
          Insurer named by the MID check
          <input name={`${prefix}midInsurer`} className={field} onChange={(e) => setMidName(e.target.value)} placeholder="Insurer name from authorised lookup" />
        </label>
      )}
      {midName.trim() && !insurerEntered ? (
        <button type="button" className="rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-navy" onClick={() => onUse(midName)} data-use-mid-insurer>
          Use this insurer ({midName.trim()})
        </button>
      ) : null}
    </div>
  );
}

function CompanyAddressFields({
  prefix,
  kind,
  postcode,
  address,
  town,
  onPostcode,
  onAddress,
  onTown,
}: {
  prefix: string;
  kind: "insurer" | "agent";
  postcode?: string;
  address?: string;
  town?: string;
  onPostcode?: (value: string) => void;
  onAddress?: (value: string) => void;
  onTown?: (value: string) => void;
}) {
  const [internalPostcode, setInternalPostcode] = useState("");
  const [internalAddress, setInternalAddress] = useState("");
  const [internalTown, setInternalTown] = useState("");
  return (
    <PostcodeAddressLookup
      postcodeName={`${prefix}${kind}Postcode`}
      addressName={`${prefix}${kind}Address`}
      townName={`${prefix}${kind}Town`}
      showTownField={false}
      postcode={postcode ?? internalPostcode}
      address={address ?? internalAddress}
      town={town ?? internalTown}
      onPostcode={onPostcode ?? setInternalPostcode}
      onAddress={onAddress ?? setInternalAddress}
      onTown={onTown ?? setInternalTown}
    />
  );
}

function ThirdPartyBlock({
  prefix,
  title,
  insurers,
  agents,
}: {
  prefix: string;
  title: string;
  insurers: KnownInsurer[];
  agents: KnownInsurer[];
}) {
  const [insurerName, setInsurerName] = useState("");
  const [insurerPostcode, setInsurerPostcode] = useState("");
  const [insurerAddress, setInsurerAddress] = useState("");
  const [insurerTown, setInsurerTown] = useState("");
  const [insurerTel, setInsurerTel] = useState("");
  const [insurerEmail, setInsurerEmail] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentPostcode, setAgentPostcode] = useState("");
  const [agentAddress, setAgentAddress] = useState("");
  const [agentTown, setAgentTown] = useState("");
  const [agentTel, setAgentTel] = useState("");
  const [agentEmail, setAgentEmail] = useState("");
  const [agentHandlerName, setAgentHandlerName] = useState("");
  const [agentHandlerEmail, setAgentHandlerEmail] = useState("");
  const [agentHandlerTel, setAgentHandlerTel] = useState("");

  function applyInsurer(picked: KnownInsurer, mode: "replace" | "empty-only") {
    const next = mergeInsurerDetails(
      {
        name: insurerName,
        address: insurerAddress,
        postcode: insurerPostcode,
        telephone: insurerTel,
        email: insurerEmail,
      },
      picked,
      mode,
    );
    setInsurerName(next.name);
    setInsurerAddress(next.address);
    setInsurerPostcode(next.postcode);
    setInsurerTel(next.telephone);
    setInsurerEmail(next.email);
  }

  function applyAgent(picked: KnownInsurer, mode: "replace" | "empty-only") {
    const next = mergeInsurerDetails(
      {
        name: agentName,
        address: agentAddress,
        postcode: agentPostcode,
        telephone: agentTel,
        email: agentEmail,
        handlerName: agentHandlerName,
        handlerEmail: agentHandlerEmail,
        handlerTel: agentHandlerTel,
      },
      picked,
      mode,
    );
    setAgentName(next.name);
    setAgentAddress(next.address);
    setAgentPostcode(next.postcode);
    setAgentTel(next.telephone);
    setAgentEmail(next.email);
    setAgentHandlerName(next.handlerName || "");
    setAgentHandlerEmail(next.handlerEmail || "");
    setAgentHandlerTel(next.handlerTel || "");
  }

  return (
    <div className="space-y-4 rounded-lg border border-line p-4">
      <h3 className="font-serif text-lg text-navy-deep">{title}</h3>
      <PersonFields prefix={prefix} kind="client" />
      <VehicleFields prefix={`${prefix}veh_`} matchLabel="Details match the third-party vehicle described" thirdParty />
      <MidCheck
        prefix={prefix}
        insurerEntered={insurerName.trim() !== ""}
        onUse={(name) => {
          const known = insurers.find((item) => item.name.trim().toLowerCase() === name.trim().toLowerCase());
          if (known) applyInsurer(known, "empty-only");
          else setInsurerName(name.trim());
        }}
      />
      <h4 className="font-serif text-base text-navy-deep">TP insurance</h4>
      <p className="text-xs text-slate">
        Start typing the insurer name. Saved telephone, email and address fill in. Policy number and claim reference stay
        blank because they are different on every file.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          Name
          <InsurerNameField
            inputName={`${prefix}insurerName`}
            value={insurerName}
            onChange={setInsurerName}
            onPick={applyInsurer}
            insurers={insurers}
            className={field}
          />
        </label>
        <CompanyAddressFields
          prefix={prefix}
          kind="insurer"
          postcode={insurerPostcode}
          address={insurerAddress}
          town={insurerTown}
          onPostcode={setInsurerPostcode}
          onAddress={setInsurerAddress}
          onTown={setInsurerTown}
        />
        <label className="block text-sm">
          Telephone
          <MobileField name={`${prefix}insurerTel`} value={insurerTel} onChange={setInsurerTel} className={field} />
        </label>
        <label className="block text-sm">
          Email
          <input
            name={`${prefix}insurerEmail`}
            type="email"
            value={insurerEmail}
            onChange={(e) => setInsurerEmail(e.target.value)}
            className={field}
          />
        </label>
        <label className="block text-sm">
          Policy number
          <input name={`${prefix}policyNumber`} className={field} />
        </label>
        <label className="block text-sm">
          Claim reference
          <input name={`${prefix}claimReference`} className={field} />
        </label>
        <label className="block text-sm">
          Handler name
          <input name={`${prefix}handlerName`} {...casingInputProps(`${prefix}handlerName`, "text", field)} />
        </label>
        <label className="block text-sm">
          Handler email
          <input name={`${prefix}handlerEmail`} type="email" {...casingInputProps(`${prefix}handlerEmail`, "email", field)} />
        </label>
        <label className="block text-sm">
          Handler telephone
          <MobileField name={`${prefix}handlerTel`} className={field} />
        </label>
      </div>
      <h4 className="font-serif text-base text-navy-deep">TPI agent</h4>
      <p className="text-xs text-slate">
        Start typing the agent name. Saved telephone, email, address and handler details fill in. The reference stays
        blank because it is different on every file.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          Name
          <InsurerNameField
            inputName={`${prefix}agentName`}
            value={agentName}
            onChange={setAgentName}
            onPick={applyAgent}
            insurers={agents}
            className={field}
          />
        </label>
        <CompanyAddressFields
          prefix={prefix}
          kind="agent"
          postcode={agentPostcode}
          address={agentAddress}
          town={agentTown}
          onPostcode={setAgentPostcode}
          onAddress={setAgentAddress}
          onTown={setAgentTown}
        />
        <label className="block text-sm">
          Telephone
          <MobileField name={`${prefix}agentTel`} value={agentTel} onChange={setAgentTel} className={field} />
        </label>
        <label className="block text-sm">
          Email
          <input
            name={`${prefix}agentEmail`}
            type="email"
            value={agentEmail}
            onChange={(e) => setAgentEmail(e.target.value)}
            className={field}
          />
        </label>
        <label className="block text-sm">
          Reference
          <input name={`${prefix}agentRef`} className={field} />
        </label>
        <label className="block text-sm">
          Handler name
          <input
            name={`${prefix}agentHandlerName`}
            value={agentHandlerName}
            onChange={(e) => setAgentHandlerName(e.target.value)}
            className={field}
          />
        </label>
        <label className="block text-sm">
          Handler email
          <input
            name={`${prefix}agentHandlerEmail`}
            type="email"
            value={agentHandlerEmail}
            onChange={(e) => setAgentHandlerEmail(e.target.value)}
            className={field}
          />
        </label>
        <label className="block text-sm">
          Handler telephone
          <MobileField name={`${prefix}agentHandlerTel`} value={agentHandlerTel} onChange={setAgentHandlerTel} className={field} />
        </label>
      </div>
      <label className="block text-sm max-w-xs">
        Liability admitted
        <select name={`${prefix}liabilityAdmitted`} className={field} defaultValue="unknown">
          <option value="unknown">Unknown</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </label>
    </div>
  );
}

function ChoiceField({
  name,
  label,
  options,
  initial = "",
  otherInitial = "",
}: {
  name: string;
  label: string;
  options: readonly { value: string; label: string }[];
  initial?: string;
  otherInitial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <label className="block text-sm">
      {label}
      <select name={name} className={field} value={value} onChange={(event) => setValue(event.target.value)}>
        <option value="">Not stated</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {value === "other" ? (
        <input name={`${name}Other`} defaultValue={otherInitial} className={field} placeholder="Type what Other means" />
      ) : null}
    </label>
  );
}

export function IntakeForm({
  staff,
  nextRef,
  error,
  errorField,
  insurers,
  agents,
  fees,
  defaults = {},
  draftId: initialDraftId = "",
  draftVersion: initialDraftVersion = "",
  currentStaffId = "",
  problems = [],
}: {
  currentStaffId?: string;
  /** R56: every problem the server found. */
  problems?: FieldProblem[];
  staff: Staff[];
  nextRef: string;
  error?: string;
  errorField?: string;
  insurers: KnownInsurer[];
  agents: KnownInsurer[];
  fees: Record<string, number>;
  defaults?: Record<string, string>;
  draftId?: string;
  draftVersion?: string;
}) {
  const [role, setRole] = useState(defaults.clientRole || "owner_driver");
  const [needsRecovery, setNeedsRecovery] = useState(defaults.needsRecovery === "yes");
  const [needsReplacement, setNeedsReplacement] = useState(defaults.needsReplacement === "yes");
  const [police, setPolice] = useState(defaults.policeAttended || "no");
  const [witnesses, setWitnesses] = useState(defaults.witnesses === "yes" || Number(defaults.witnessCount || "0") > 0 ? "yes" : "no");
  const [witnessCount, setWitnessCount] = useState(Math.max(Number(defaults.witnessCount || "0") > 0 ? Number(defaults.witnessCount) : defaults.witnesses === "yes" ? 1 : 0, 0));
  const [photosAtScene, setPhotosAtScene] = useState(defaults.photosAtScene || "no");
  const [tp2, setTp2] = useState(defaults.includeTp2 === "yes");
  const [tp3, setTp3] = useState(defaults.includeTp3 === "yes");
  const [location, setLocation] = useState(defaults.location || "");
  const [facts, setFacts] = useState<CallFacts>(() => callFactsFrom(defaults));
  const [draftId, setDraftId] = useState(initialDraftId);
  const [draftVersion, setDraftVersion] = useState(initialDraftVersion);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [savedAt, setSavedAt] = useState("");
  const savedKeyRef = useRef("");
  const submittingRef = useRef(false);
  const [draftClash, setDraftClash] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const maps = useMemo(() => googleMapsSearchUrl(location), [location]);
  const versionRef = useRef(initialDraftVersion);
  const idRef = useRef(initialDraftId);
  const anchorRef = useRef<HTMLInputElement>(null);
  const restoredRef = useRef(false);

  // A saved draft (or a website enquiry) fills every box it has a value for, including the client's name and mobile.
  // A second pass catches boxes that only appear once an earlier choice has been put back.
  useEffect(() => {
    const form = anchorRef.current?.form;
    if (restoredRef.current || !form || Object.keys(defaults).length === 0) return;
    restoredRef.current = true;
    restoreDraftBoxes(form, defaults);
    const timer = window.setTimeout(() => restoreDraftBoxes(form, defaults), 0);
    return () => window.clearTimeout(timer);
  }, [defaults]);

  /** Every named box in the form as it is now, however it was filled. */
  function snapshot(form: HTMLFormElement): { key: string; fields: Record<string, string> } {
    const fields: Record<string, string> = {};
    for (const [name, value] of new FormData(form).entries()) {
      if (typeof value !== "string" || name === "submitKey" || name.startsWith("$ACTION")) continue;
      fields[name] = name in fields ? `${fields[name]},${value}` : value;
    }
    return { key: JSON.stringify(fields), fields };
  }

  // R54: the draft is saved after any change: typing, a drop-down, a tick, a picked suggestion, a lookup filling boxes,
  // or the damage drawing. The form is read every moment; 1.5 seconds after the last change it is saved. A failed save
  // says so and is tried again.
  useEffect(() => {
    const form = anchorRef.current?.form;
    if (!form) return;
    let lastSeen = "";
    let changedAt = 0;
    let inFlight = false;
    let retryAt = 0;
    const settle = window.setTimeout(() => {
      savedKeyRef.current = snapshot(form).key;
      lastSeen = savedKeyRef.current;
    }, 300);
    const tick = window.setInterval(() => {
      if (submittingRef.current) return;
      const now = Date.now();
      const current = snapshot(form);
      if (current.key !== lastSeen) {
        lastSeen = current.key;
        changedAt = now;
        setFacts(readCallFacts(form));
      }
      if (inFlight || current.key === savedKeyRef.current || now - changedAt < 1500 || now < retryAt) return;
      inFlight = true;
      setSaveState("saving");
      fetch("/claims/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: idRef.current, version: versionRef.current, fields: current.fields }),
      })
        .then(async (response) => {
          const body = (await response.json()) as { id?: string; version?: string; error?: string };
          if (response.status === 409) {
            setDraftClash(body.error || "Someone else saved this draft. Your entries are still on this page.");
            setSaveState("failed");
            retryAt = Number.POSITIVE_INFINITY;
            return;
          }
          if (!response.ok || !body.id || !body.version) throw new Error("not saved");
          idRef.current = body.id;
          versionRef.current = body.version;
          setDraftId(body.id);
          setDraftVersion(body.version);
          savedKeyRef.current = current.key;
          setSavedAt(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date()));
          setSaveState("saved");
          setDraftClash("");
        })
        .catch(() => {
          setSaveState("failed");
          retryAt = Date.now() + 5000;
        })
        .finally(() => {
          inFlight = false;
        });
    }, 500);
    // Leaving with changes that are not saved yet asks first.
    const leaving = (event: BeforeUnloadEvent) => {
      if (submittingRef.current || snapshot(form).key === savedKeyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", leaving);
    const submitted = () => {
      submittingRef.current = true;
    };
    form.addEventListener("submit", submitted);
    return () => {
      window.clearTimeout(settle);
      window.clearInterval(tick);
      window.removeEventListener("beforeunload", leaving);
      form.removeEventListener("submit", submitted);
    };
  }, []);

  return (
    <>
    <ValidatedForm action={actionCreateClaim} className="space-y-6" initialError={error} initialErrorField={errorField} initialProblems={problems} encType="multipart/form-data">
      {error && !problems.length && !errorField ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p>
      ) : null}
      <p className="text-sm text-slate">
        Next demonstration reference: <strong>{nextRef}</strong>. Opening this file does not start hire charges. Lookups,
        WhatsApp and email are simulated until the live accounts are connected.
      </p>
      <input ref={anchorRef} type="hidden" name="draftId" value={draftId} />
      <input type="hidden" name="draftVersion" value={draftVersion} />
      <input type="hidden" name="recoveryFormVersion" value="fees" />
      <input type="hidden" name="agreementChannel" value="none" />
      <p className={`text-sm ${saveState === "failed" ? "font-semibold text-overdue" : "text-teal-dark"}`} role="status" aria-live="polite" data-draft-status={saveState}>
        {saveState === "saving" ? "Saving…" : saveState === "failed" ? "Not saved – check your connection. Trying again." : saveState === "saved" ? `Saved ${savedAt}` : ""}
      </p>
      {draftClash ? (
        <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">
          {draftClash} Your entries are still in the boxes.{" "}
          {draftId ? (
            <a className="font-semibold text-navy underline" href={`/claims/new?draft=${draftId}`}>
              Reload the latest version
            </a>
          ) : null}
        </p>
      ) : null}

      <Section n={1} title="Client details">
        <label className="block text-sm max-w-sm">
          Are you
          <select name="clientRole" className={field} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="owner_driver">Owner/driver</option>
            <option value="owner">Owner</option>
            <option value="driver">Driver</option>
          </select>
        </label>
        <PersonFields prefix="client_" skipOther kind={clientDobKind(role)} />
        {role !== "owner_driver" ? (
          <div className="rounded-lg border border-dashed border-copper/40 bg-[#fbf6ec] p-4">
            <h3 className="font-serif text-lg text-navy-deep">
              {role === "owner" ? "Driver details" : "Owner details"}
            </h3>
            <p className="mb-3 text-xs text-slate">Taken because the client is not both owner and driver.</p>
            <PersonFields prefix="counterpart_" skipOther kind={counterpartDobKind(role)} />
          </div>
        ) : null}
      </Section>

      <Section n={2} title="The accident">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            Date
            <AccidentDateField name="accidentDate" className={field} />
          </label>
          <label className="block text-sm">
            Time
            <input name="accidentTime" type="time" className={field} />
          </label>
        </div>
        <label className="block text-sm">
          Location
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              name="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className={field + " !mt-0 flex-1"}
            />
            {maps ? (
              <a className="rounded-md border border-line px-3 py-2 text-sm text-teal-dark" href={maps} target="_blank" rel="noreferrer">
                View on Google Maps
              </a>
            ) : null}
          </div>
        </label>
        <label className="block text-sm">
          Accident details
          <textarea name="circumstances" rows={4} {...casingInputProps("circumstances", "textarea", field)} />
        </label>
        <label className="block text-sm max-w-xs">
          Were any photographs taken at the scene
          <select
            name="photosAtScene"
            className={field}
            value={photosAtScene}
            onChange={(e) => setPhotosAtScene(e.target.value)}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </label>
        {photosAtScene === "yes" ? (
          <div className="space-y-2 rounded-md border border-dashed border-line bg-paper p-3">
            <label className="flex items-center gap-2 text-sm">
              <input name="requestScenePhotosWhatsapp" type="checkbox" value="yes" />
              Ask the client to send them in via WhatsApp (simulated — not sent to a live number)
            </label>
            <p className="text-xs text-slate">
              Incoming photographs can be filed on the file under Email / WhatsApp / Calls after it is created. Photo
              files cannot be uploaded in this prototype.
            </p>
          </div>
        ) : null}
        <label className="block text-sm max-w-xs">
          Did the police attend
          <select name="policeAttended" className={field} value={police} onChange={(e) => setPolice(e.target.value)}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </label>
        {police === "yes" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Police reference
              <input name="policeRef" className={field} />
            </label>
            <label className="block text-sm sm:col-span-2">
              Other police details
              <input name="policeDetails" {...casingInputProps("policeDetails", "text", field)} />
            </label>
          </div>
        ) : null}
        <label className="block text-sm max-w-xs">
          Any witnesses
          <select
            name="witnesses"
            className={field}
            value={witnesses}
            onChange={(e) => {
              setWitnesses(e.target.value);
              if (e.target.value === "yes" && witnessCount < 1) setWitnessCount(1);
              if (e.target.value === "no") setWitnessCount(0);
            }}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </label>
        <input type="hidden" name="witnessCount" value={String(witnessCount)} />
        {witnesses === "yes"
          ? Array.from({ length: witnessCount }, (_, index) => (
              <div key={index} className="grid gap-3 rounded-md border border-dashed border-line p-3 sm:grid-cols-2">
                <label className="block text-sm">
                  Witness {index + 1} name
                  <input name={`witness_${index}_name`} defaultValue={defaults[`witness_${index}_name`] || ""} {...casingInputProps(`witness_${index}_name`, "text", field)} />
                </label>
                <label className="block text-sm">
                  Contact number
                  <MobileField name={`witness_${index}_telephone`} defaultValue={defaults[`witness_${index}_telephone`] || ""} className={field} />
                </label>
                <label className="block text-sm">
                  Postcode
                  <input name={`witness_${index}_postcode`} defaultValue={defaults[`witness_${index}_postcode`] || ""} {...casingInputProps(`witness_${index}_postcode`, "text", field)} />
                </label>
                <label className="block text-sm">
                  Town
                  <input name={`witness_${index}_town`} defaultValue={defaults[`witness_${index}_town`] || ""} {...casingInputProps(`witness_${index}_town`, "text", field)} />
                </label>
                <label className="block text-sm sm:col-span-2">
                  Address (manual if no postcode)
                  <input name={`witness_${index}_address`} defaultValue={defaults[`witness_${index}_address`] || ""} {...casingInputProps(`witness_${index}_address`, "text", field)} />
                </label>
              </div>
            ))
          : null}
        {witnesses === "yes" ? (
          <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={() => setWitnessCount((count) => count + 1)}>
            Add another witness
          </button>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceField name="weather" label="Weather conditions" options={WEATHER_OPTIONS} initial={defaults.weather || ""} otherInitial={defaults.weatherOther || ""} />
          <ChoiceField name="journeyPurpose" label="Purpose of journey" options={JOURNEY_OPTIONS} initial={defaults.journeyPurpose || ""} otherInitial={defaults.journeyPurposeOther || ""} />
          <ChoiceField name="roadSurface" label="Road surface" options={ROAD_SURFACE_OPTIONS} initial={defaults.roadSurface || ""} otherInitial={defaults.roadSurfaceOther || ""} />
          <ChoiceField name="lighting" label="Lighting" options={LIGHTING_OPTIONS} initial={defaults.lighting || ""} />
          <label className="block text-sm">
            Approx speed of client vehicle
            <input name="clientSpeed" className={field} />
          </label>
          <label className="block text-sm">
            Approx speed of third-party vehicle
            <input name="tpSpeed" className={field} />
          </label>
        </div>
      </Section>

      <Section n={3} title="The client's vehicle and damage">
        <VehicleFields prefix="veh_" matchLabel="Details match the client" />
        <div className="space-y-2" data-damage-drawing>
          <p className="text-sm font-semibold">Where is the damage? Tap each damaged area. Tap again to remove it.</p>
          <CarDamageDiagram name="damageZones" initial={defaults.damageZones || ""} />
        </div>
        <label className="block text-sm">
          Description
          <textarea name="damageDescription" rows={3} {...casingInputProps("damageDescription", "textarea", field)} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input name="requestPhotosWhatsapp" type="checkbox" value="yes" />
          Ask the client to send photographs via WhatsApp (simulated — not sent to a live number)
        </label>
        <p className="text-xs text-slate">Photo files can also be added on the file after it is created.</p>
        <SafeToDriveQuestions defaults={defaults} />
        <label className="flex items-center gap-2 text-sm">
          <input
            name="needsRecovery"
            type="checkbox"
            value="yes"
            checked={needsRecovery}
            onChange={(e) => setNeedsRecovery(e.target.checked)}
          />
          Client needs recovery
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            name="needsReplacement"
            type="checkbox"
            value="yes"
            checked={needsReplacement}
            onChange={(e) => setNeedsReplacement(e.target.checked)}
          />
          Client needs a replacement vehicle
        </label>
      </Section>

      {needsReplacement ? (
        <Section n={4} title="Replacement vehicle">
          <p className="text-xs text-slate">This records what is needed. It does not book a car or start hire.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Date needed from
              <input name="hireNeededFrom" type="date" defaultValue={defaults.hireNeededFrom || ""} className={field} />
            </label>
            <label className="block text-sm">
              Vehicle type/size
              <input name="hireVehicleType" defaultValue={defaults.hireVehicleType || ""} {...casingInputProps("hireVehicleType", "text", field)} />
            </label>
            <label className="block text-sm">
              Manual or automatic
              <select name="hireTransmission" className={field} defaultValue={defaults.hireTransmission || ""}>
                <option value="">Not stated</option>
                <option value="manual">Manual</option>
                <option value="automatic">Automatic</option>
              </select>
            </label>
            <label className="block text-sm">
              Number of seats
              <input name="hireSeats" inputMode="numeric" defaultValue={defaults.hireSeats || ""} className={field} />
            </label>
            <label className="block text-sm sm:col-span-2">
              Client’s own vehicle group (GTA), if known
              <input name="hireGtaGroup" defaultValue={defaults.hireGtaGroup || ""} className={field} />
            </label>
          </div>
          <p className="text-xs text-slate">The hire rate is based on this group.</p>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input name="hireTaxi" type="checkbox" value="yes" defaultChecked={defaults.hireTaxi === "yes"} /> Taxi/PCO</label>
            <label className="flex items-center gap-2"><input name="hireWheelchair" type="checkbox" value="yes" defaultChecked={defaults.hireWheelchair === "yes"} /> Wheelchair access</label>
            <label className="flex items-center gap-2"><input name="hireTowbar" type="checkbox" value="yes" defaultChecked={defaults.hireTowbar === "yes"} /> Towbar</label>
          </div>
          <label className="block text-sm">
            Other special requirement
            <input name="hireOther" defaultValue={defaults.hireOther || ""} {...casingInputProps("hireOther", "text", field)} />
          </label>
        </Section>
      ) : null}

      {needsRecovery ? (
        <Section n={5} title="Recovery">
          <label className="block text-sm">
            Recovery location
            <input name="recoveryLocation" defaultValue={defaults.recoveryLocation || location} {...casingInputProps("recoveryLocation", "text", field)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input name="notifyDriverWhatsapp" type="checkbox" value="yes" defaultChecked={defaults.notifyDriverWhatsapp === "yes"} />
            Send location and client details to the recovery driver via WhatsApp (simulated)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input name="notifyClientWhatsapp" type="checkbox" value="yes" defaultChecked={defaults.notifyClientWhatsapp === "yes"} />
            Message the client that recovery is on the way (simulated)
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Recovery date
              <input name="recoveryDate" type="date" defaultValue={defaults.recoveryDate || ""} className={field} />
            </label>
            <label className="block text-sm">
              Recovery time
              <input name="recoveryTime" type="time" defaultValue={defaults.recoveryTime || ""} className={field} />
            </label>
          </div>
          <p className="text-xs text-slate">Leave the date blank if the car has not been recovered yet. Charges go on the file only when the recovery date and time are recorded.</p>
          <RecoveryFeeFields fees={fees} defaults={defaults} />
          <label className="flex items-center gap-2 text-sm">
            <input name="inheritedRecovery" type="checkbox" value="yes" defaultChecked={defaults.inheritedRecovery === "yes"} />
            There is an inherited recovery charge
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm sm:col-span-2">
              Company that charged it
              <input name="inheritedCompany" defaultValue={defaults.inheritedCompany || ""} {...casingInputProps("inheritedCompany", "text", field)} />
            </label>
            <label className="block text-sm">
              Net amount on the receipt (£)
              <input name="inheritedNet" defaultValue={defaults.inheritedNet || ""} className={field} />
            </label>
            <label className="block text-sm">
              VAT on the receipt (£)
              <input name="inheritedVat" defaultValue={defaults.inheritedVat || ""} className={field} />
            </label>
            <label className="block text-sm sm:col-span-2">
              Receipt
              <input name="inheritedReceipt" type="file" className={field} />
            </label>
          </div>
          <label className="block text-sm max-w-xs">
            Storage rate per day (£)
            <input name="storageRate" defaultValue={defaults.storageRate || "39"} className={field} />
          </label>
          <p className="text-xs text-slate">
            Storage starts on the recovery date when recovery is recorded. A storage billing end date is not invented.
          </p>
          <p className="text-xs text-slate">
            The credit recovery and storage agreement can be prepared as a draft. CAS template wording is still outstanding, so it is not sent.
          </p>
        </Section>
      ) : null}

      <Section n={6} title="Third-party details">
        <ThirdPartyBlock prefix="tp1_" title="Third party 1" insurers={insurers} agents={agents} />
      </Section>

      <Section n={7} title="Third party 2">
        <label className="flex items-center gap-2 text-sm">
          <input name="includeTp2" type="checkbox" value="yes" checked={tp2} onChange={(e) => setTp2(e.target.checked)} />
          Another vehicle was involved
        </label>
        {tp2 ? <ThirdPartyBlock prefix="tp2_" title="Third party 2" insurers={insurers} agents={agents} /> : null}
      </Section>

      <Section n={8} title="Third party 3">
        <label className="flex items-center gap-2 text-sm">
          <input name="includeTp3" type="checkbox" value="yes" checked={tp3} onChange={(e) => setTp3(e.target.checked)} />
          A further vehicle was involved
        </label>
        {tp3 ? <ThirdPartyBlock prefix="tp3_" title="Third party 3" insurers={insurers} agents={agents} /> : null}
      </Section>

      <FileSetupFields staff={staff} defaults={defaults} currentStaffId={currentStaffId} facts={facts} n={9} />

      <div className="flex flex-wrap items-center gap-3">
        <button className="rounded-md bg-teal px-5 py-3 text-sm font-semibold text-white" type="submit">
          Create claim
        </button>
      </div>
    </ValidatedForm>
    {draftId ? (
      <form action="/claims/drafts/discard" method="post" className="mt-4 space-y-2 rounded-xl border border-line bg-card p-5">
        <input type="hidden" name="draftId" value={draftId} />
        <input type="hidden" name="draftVersion" value={draftVersion} />
        <label className="flex items-center gap-2 text-sm">
          <input name="confirmDiscard" type="checkbox" value="yes" checked={confirmDiscard} onChange={(event) => setConfirmDiscard(event.target.checked)} />
          I want to discard this draft
        </label>
        <button type="submit" className="rounded-md border border-line px-4 py-2 text-sm" disabled={!confirmDiscard}>
          Discard draft
        </button>
      </form>
    ) : null}
    </>
  );
}
