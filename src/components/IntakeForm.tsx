"use client";

import { useMemo, useState } from "react";
import {
  actionCreateClaim,
  actionLookupCompliance,
  actionLookupVehicle,
} from "@/app/actions";
import { AccidentDateField } from "@/components/AccidentDateField";
import { AgeField } from "@/components/AgeField";
import { casingInputProps } from "@/components/CasedField";
import { PostcodeAddressLookup } from "@/components/PostcodeAddressLookup";
import type { DobKind } from "@/lib/age";
import { clientDobKind, counterpartDobKind } from "@/lib/age";
import { ASK_MID_URL, GOV_MOT_URL, GOV_TAX_URL } from "@/lib/lookups/compliance";
import { googleMapsSearchUrl } from "@/lib/lookups/maps";
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
          <input name={`${prefix}mobile`} {...casingInputProps(`${prefix}mobile`, "text", field)} />
        </label>
      ) : (
        <label className="block text-sm">
          Telephone
          <input name={`${prefix}telephone`} {...casingInputProps(`${prefix}telephone`, "text", field)} />
        </label>
      )}
      {skipOther ? (
        <>
          <label className="block text-sm">
            Other contact number
            <input name={`${prefix}otherTel`} disabled={skip} {...casingInputProps(`${prefix}otherTel`, "text", field)} />
          </label>
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

function VehicleFields({
  prefix,
  matchLabel,
  includeInsuranceRecord,
}: {
  prefix: string;
  matchLabel: string;
  includeInsuranceRecord?: boolean;
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
      if (v.fuel) setFuel(toStartCase(v.fuel));
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
    setTaxStatus(res.result.taxStatus);
    setMotStatus(res.result.motStatus);
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
        <label className="block text-sm">
          Gearbox
          <select name={`${prefix}gearbox`} className={field} value={gearbox} onChange={(e) => setGearbox(e.target.value)}>
            <option value="unknown">Unknown — do not guess</option>
            <option value="manual">Manual</option>
            <option value="automatic">Automatic</option>
          </select>
        </label>
        <label className="block text-sm">
          Fuel
          <input
            name={`${prefix}fuel`}
            value={fuel}
            onChange={(e) => setFuel(toStartCaseLive(e.target.value))}
            onBlur={() => setFuel(toStartCase(fuel))}
            className={field}
          />
        </label>
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
      {includeInsuranceRecord ? (
        <label className="block text-sm">
          AskMID insurer recorded
          <input
            name={`${prefix.replace("veh_", "")}midInsurer`}
            {...casingInputProps(`${prefix.replace("veh_", "")}midInsurer`, "text", field)}
            placeholder="Insurer name from authorised lookup"
          />
        </label>
      ) : null}
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

function CompanyAddressFields({ prefix, kind }: { prefix: string; kind: "insurer" | "agent" }) {
  const [postcode, setPostcode] = useState("");
  const [address, setAddress] = useState("");
  const [town, setTown] = useState("");
  return (
    <PostcodeAddressLookup
      postcodeName={`${prefix}${kind}Postcode`}
      addressName={`${prefix}${kind}Address`}
      townName={`${prefix}${kind}Town`}
      showTownField={false}
      postcode={postcode}
      address={address}
      town={town}
      onPostcode={setPostcode}
      onAddress={setAddress}
      onTown={setTown}
    />
  );
}

function ThirdPartyBlock({ prefix, title }: { prefix: string; title: string }) {
  return (
    <div className="space-y-4 rounded-lg border border-line p-4">
      <h3 className="font-serif text-lg text-navy-deep">{title}</h3>
      <PersonFields prefix={prefix} kind="client" />
      <VehicleFields prefix={`${prefix}veh_`} matchLabel="Details match the third-party vehicle described" includeInsuranceRecord />
      <h4 className="font-serif text-base text-navy-deep">TP insurance</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          Name
          <input name={`${prefix}insurerName`} {...casingInputProps(`${prefix}insurerName`, "text", field)} />
        </label>
        <CompanyAddressFields prefix={prefix} kind="insurer" />
        <label className="block text-sm">
          Telephone
          <input name={`${prefix}insurerTel`} {...casingInputProps(`${prefix}insurerTel`, "text", field)} />
        </label>
        <label className="block text-sm">
          Email
          <input name={`${prefix}insurerEmail`} type="email" {...casingInputProps(`${prefix}insurerEmail`, "email", field)} />
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
          <input name={`${prefix}handlerTel`} {...casingInputProps(`${prefix}handlerTel`, "text", field)} />
        </label>
      </div>
      <h4 className="font-serif text-base text-navy-deep">TPI agent</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          Name
          <input name={`${prefix}agentName`} {...casingInputProps(`${prefix}agentName`, "text", field)} />
        </label>
        <CompanyAddressFields prefix={prefix} kind="agent" />
        <label className="block text-sm">
          Telephone
          <input name={`${prefix}agentTel`} {...casingInputProps(`${prefix}agentTel`, "text", field)} />
        </label>
        <label className="block text-sm">
          Email
          <input name={`${prefix}agentEmail`} type="email" {...casingInputProps(`${prefix}agentEmail`, "email", field)} />
        </label>
        <label className="block text-sm">
          Reference
          <input name={`${prefix}agentRef`} className={field} />
        </label>
        <label className="block text-sm">
          Handler name
          <input name={`${prefix}agentHandlerName`} {...casingInputProps(`${prefix}agentHandlerName`, "text", field)} />
        </label>
        <label className="block text-sm">
          Handler email
          <input name={`${prefix}agentHandlerEmail`} type="email" {...casingInputProps(`${prefix}agentHandlerEmail`, "email", field)} />
        </label>
        <label className="block text-sm">
          Handler telephone
          <input name={`${prefix}agentHandlerTel`} {...casingInputProps(`${prefix}agentHandlerTel`, "text", field)} />
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

export function IntakeForm({
  staff,
  nextRef,
  error,
}: {
  staff: Staff[];
  nextRef: string;
  error?: string;
}) {
  const [role, setRole] = useState("owner_driver");
  const [needsRecovery, setNeedsRecovery] = useState(false);
  const [police, setPolice] = useState("no");
  const [witnesses, setWitnesses] = useState("no");
  const [tp2, setTp2] = useState(false);
  const [tp3, setTp3] = useState(false);
  const [location, setLocation] = useState("");
  const maps = useMemo(() => googleMapsSearchUrl(location), [location]);

  return (
    <form action={actionCreateClaim} className="space-y-6">
      {error ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p>
      ) : null}
      <p className="text-sm text-slate">
        Next demonstration reference: <strong>{nextRef}</strong>. Opening this file does not start hire charges. Lookups,
        WhatsApp and email are simulated until the live accounts are connected.
      </p>

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

      <Section n={2} title="Vehicle details">
        <VehicleFields prefix="veh_" matchLabel="Details match the client" />
      </Section>

      <Section n={3} title="Vehicle damage">
        <label className="block text-sm">
          Description
          <textarea name="damageDescription" rows={3} {...casingInputProps("damageDescription", "textarea", field)} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input name="requestPhotosWhatsapp" type="checkbox" value="yes" />
          Ask the client to send photographs via WhatsApp (simulated — not sent to a live number)
        </label>
        <p className="text-xs text-slate">Photo files can also be added on the file after it is created.</p>
      </Section>

      <Section n={4} title="Accident details">
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
              onChange={(e) => setLocation(toStartCaseLive(e.target.value))}
              onBlur={() => setLocation(toStartCase(location))}
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
          <select name="witnesses" className={field} value={witnesses} onChange={(e) => setWitnesses(e.target.value)}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </label>
        {witnesses === "yes" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Witness name
              <input name="witness_name" {...casingInputProps("witness_name", "text", field)} />
            </label>
            <label className="block text-sm">
              Contact number
              <input name="witness_telephone" className={field} />
            </label>
            <label className="block text-sm">
              Postcode
              <input name="witness_postcode" {...casingInputProps("witness_postcode", "text", field)} />
            </label>
            <label className="block text-sm">
              Town
              <input name="witness_town" {...casingInputProps("witness_town", "text", field)} />
            </label>
            <label className="block text-sm sm:col-span-2">
              Address (manual if no postcode)
              <input name="witness_address" {...casingInputProps("witness_address", "text", field)} />
            </label>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            Weather conditions
            <input name="weather" {...casingInputProps("weather", "text", field)} />
          </label>
          <label className="block text-sm">
            Purpose of journey
            <input name="journeyPurpose" {...casingInputProps("journeyPurpose", "text", field)} />
          </label>
          <label className="block text-sm">
            Approx speed of client vehicle
            <input name="clientSpeed" className={field} />
          </label>
          <label className="block text-sm">
            Approx speed of third-party vehicle
            <input name="tpSpeed" className={field} />
          </label>
        </div>
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
      </Section>

      {needsRecovery ? (
        <Section n={5} title="Recovery">
          <label className="block text-sm">
            Recovery location
            <input name="recoveryLocation" defaultValue={location} {...casingInputProps("recoveryLocation", "text", field)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input name="notifyDriverWhatsapp" type="checkbox" value="yes" />
            Send location and client details to the recovery driver via WhatsApp (simulated)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input name="notifyClientWhatsapp" type="checkbox" value="yes" />
            Message the client that recovery is on the way (simulated)
          </label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-sm">
              Recovery date
              <input name="recoveryDate" type="date" className={field} />
            </label>
            <label className="block text-sm">
              Recovery charge
              <input name="recoveryCharge" className={field} placeholder="395.00" />
            </label>
            <label className="block text-sm">
              Winch
              <input name="recoveryWinch" className={field} placeholder="0.00" />
            </label>
            <label className="block text-sm">
              Out of hours
              <input name="recoveryOoh" className={field} placeholder="0.00" />
            </label>
            <label className="block text-sm">
              Environmental
              <input name="recoveryEnvironmental" className={field} placeholder="0.00" />
            </label>
            <label className="block text-sm">
              Forklift
              <input name="recoveryForklift" className={field} placeholder="0.00" />
            </label>
            <label className="block text-sm">
              Mileage charge
              <input name="recoveryMileage" className={field} placeholder="0.00" />
            </label>
            <label className="block text-sm">
              Manual charge
              <input name="recoveryManual" className={field} placeholder="0.00" />
            </label>
          </div>
          <p className="text-xs text-slate">Enter the actual amounts. Defaults are not added automatically.</p>
          <label className="flex items-center gap-2 text-sm">
            <input name="inheritedRecovery" type="checkbox" value="yes" />
            There is an inherited recovery charge (upload the receipt on the file after saving — amount is not invented)
          </label>
          <label className="block text-sm">
            Inherited recovery note
            <input name="inheritedNote" {...casingInputProps("inheritedNote", "text", field)} />
          </label>
          <label className="block text-sm max-w-xs">
            Storage rate per day
            <input name="storageRate" className={field} placeholder="39.00" />
          </label>
          <p className="text-xs text-slate">
            Storage starts on the same day as recovery. A storage billing end date is not invented.
          </p>
          <label className="block text-sm max-w-sm">
            Send credit recovery and storage agreement
            <select name="agreementChannel" className={field} defaultValue="none">
              <option value="none">Do not send yet</option>
              <option value="whatsapp">WhatsApp (simulated)</option>
              <option value="email">Email (simulated)</option>
              <option value="both">WhatsApp and email (simulated)</option>
            </select>
          </label>
          <p className="text-xs text-slate">
            The agreement is generated unsigned from the facts on this file. CAS template wording is still outstanding.
          </p>
        </Section>
      ) : (
        <input type="hidden" name="agreementChannel" value="none" />
      )}

      <Section n={6} title="Third-party details">
        <ThirdPartyBlock prefix="tp1_" title="Third party 1" />
      </Section>

      <Section n={7} title="Third party 2">
        <label className="flex items-center gap-2 text-sm">
          <input name="includeTp2" type="checkbox" value="yes" checked={tp2} onChange={(e) => setTp2(e.target.checked)} />
          Another vehicle was involved
        </label>
        {tp2 ? <ThirdPartyBlock prefix="tp2_" title="Third party 2" /> : null}
      </Section>

      <Section n={8} title="Third party 3">
        <label className="flex items-center gap-2 text-sm">
          <input name="includeTp3" type="checkbox" value="yes" checked={tp3} onChange={(e) => setTp3(e.target.checked)} />
          A further vehicle was involved
        </label>
        {tp3 ? <ThirdPartyBlock prefix="tp3_" title="Third party 3" /> : null}
      </Section>

      <section className="space-y-3 rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">File setup</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            Claim type
            <select name="claimType" className={field} defaultValue="unknown">
              <option value="unknown">Unknown</option>
              <option value="non_fault">Non-fault</option>
              <option value="fault">Fault</option>
            </select>
          </label>
          <label className="block text-sm">
            Roadworthiness
            <select name="roadworthiness" className={field} defaultValue="awaiting_assessment">
              <option value="awaiting_assessment">Awaiting assessment</option>
              <option value="roadworthy">Roadworthy</option>
              <option value="unroadworthy">Unroadworthy / undriveable</option>
              <option value="needs_review">Needs review</option>
            </select>
          </label>
          <label className="block text-sm">
            Handler
            <select name="handlerId" className={field} defaultValue="staff-sian">
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-slate">AI does not certify roadworthiness. Unknown information is stored as unknown.</p>
        <button className="rounded-md bg-teal px-5 py-3 text-sm font-semibold text-white" type="submit">
          Create claim
        </button>
      </section>
    </form>
  );
}
