"use client";

import { useState } from "react";
import { InsurerNameField } from "@/components/InsurerNameField";
import { PostcodeAddressLookup } from "@/components/PostcodeAddressLookup";
import { mergeInsurerDetails, type KnownInsurer } from "@/lib/insurers";
import { displayValue } from "@/lib/screen-display";
import type { ScreenValues } from "@/lib/db/screens";

const control = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export function TpInsuranceFields({
  values,
  insurers,
}: {
  values: ScreenValues;
  insurers: KnownInsurer[];
}) {
  const [name, setName] = useState(displayValue("tp1", "insurerName", values.insurerName || ""));
  const [address, setAddress] = useState(displayValue("tp1", "insurerAddress", values.insurerAddress || ""));
  const [postcode, setPostcode] = useState(displayValue("tp1", "insurerPostcode", values.insurerPostcode || ""));
  const [town, setTown] = useState("");
  const [telephone, setTelephone] = useState(values.insurerTel || "");
  const [email, setEmail] = useState(values.insurerEmail || "");

  function applyInsurer(picked: KnownInsurer, mode: "replace" | "empty-only") {
    const next = mergeInsurerDetails(
      { name, address, postcode, telephone, email },
      picked,
      mode,
    );
    setName(next.name);
    setAddress(next.address);
    setPostcode(next.postcode);
    setTelephone(next.telephone);
    setEmail(next.email);
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <p className="sm:col-span-2 text-xs text-slate">
        Start typing the insurer name. Saved telephone, email and address fill in. Policy number and claim reference stay
        blank because they are different on every file.
      </p>
      <label className="block text-sm">
        Name
        <InsurerNameField
          inputName="insurerName"
          value={name}
          onChange={setName}
          onPick={applyInsurer}
          insurers={insurers}
          className={control}
        />
      </label>
      <div className="sm:col-span-2">
        <PostcodeAddressLookup
          postcodeName="insurerPostcode"
          addressName="insurerAddress"
          townName="insurerTown"
          showTownField={false}
          postcode={postcode}
          address={address}
          town={town}
          onPostcode={setPostcode}
          onAddress={setAddress}
          onTown={setTown}
        />
      </div>
      <label className="block text-sm">
        Tel main
        <input name="insurerTel" value={telephone} onChange={(e) => setTelephone(e.currentTarget.value)} className={control} />
      </label>
      <label className="block text-sm">
        Email
        <input
          name="insurerEmail"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          className={control}
        />
      </label>
      <label className="block text-sm">
        Reference
        <input name="insurerReference" defaultValue={values.insurerReference || ""} className={control} />
      </label>
      <label className="block text-sm">
        Policy no.
        <input name="policyNumber" defaultValue={values.policyNumber || ""} className={control} />
      </label>
      <label className="block text-sm">
        Liability declared
        <select name="liabilityDeclared" className={control} defaultValue={values.liabilityDeclared || ""}>
          <option value="">Unknown</option>
          <option value="admitted">Admitted</option>
          <option value="denied">Denied</option>
          <option value="pending">Pending</option>
        </select>
      </label>
    </div>
  );
}
