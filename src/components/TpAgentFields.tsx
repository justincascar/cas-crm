"use client";

import { useState } from "react";
import { InsurerNameField } from "@/components/InsurerNameField";
import { PostcodeAddressLookup } from "@/components/PostcodeAddressLookup";
import { mergeInsurerDetails, type KnownInsurer } from "@/lib/insurers";
import { displayValue } from "@/lib/screen-display";
import type { ScreenValues } from "@/lib/db/screens";

const control = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export function TpAgentFields({
  values,
  agents,
}: {
  values: ScreenValues;
  agents: KnownInsurer[];
}) {
  const [name, setName] = useState(displayValue("tp1", "agentName", values.agentName || ""));
  const [address, setAddress] = useState(displayValue("tp1", "agentAddress", values.agentAddress || ""));
  const [postcode, setPostcode] = useState(displayValue("tp1", "agentPostcode", values.agentPostcode || ""));
  const [town, setTown] = useState("");
  const [telephone, setTelephone] = useState(values.agentTel || "");
  const [email, setEmail] = useState(values.agentEmail || "");
  const [handlerName, setHandlerName] = useState(displayValue("tp1", "agentHandlerName", values.agentHandlerName || ""));
  const [handlerEmail, setHandlerEmail] = useState(values.agentHandlerEmail || "");
  const [handlerTel, setHandlerTel] = useState(values.agentHandlerTel || "");

  function applyAgent(picked: KnownInsurer, mode: "replace" | "empty-only") {
    const next = mergeInsurerDetails(
      {
        name,
        address,
        postcode,
        telephone,
        email,
        handlerName,
        handlerEmail,
        handlerTel,
      },
      picked,
      mode,
    );
    setName(next.name);
    setAddress(next.address);
    setPostcode(next.postcode);
    setTelephone(next.telephone);
    setEmail(next.email);
    setHandlerName(next.handlerName || "");
    setHandlerEmail(next.handlerEmail || "");
    setHandlerTel(next.handlerTel || "");
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <p className="sm:col-span-2 text-xs text-slate">
        Start typing the agent name. Saved telephone, email, address and handler details fill in. The reference stays
        blank because it is different on every file.
      </p>
      <label className="block text-sm">
        Name
        <InsurerNameField
          inputName="agentName"
          value={name}
          onChange={setName}
          onPick={applyAgent}
          insurers={agents}
          className={control}
        />
      </label>
      <div className="sm:col-span-2">
        <PostcodeAddressLookup
          postcodeName="agentPostcode"
          addressName="agentAddress"
          townName="agentTown"
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
        <input name="agentTel" value={telephone} onChange={(e) => setTelephone(e.currentTarget.value)} className={control} />
      </label>
      <label className="block text-sm">
        Email
        <input
          name="agentEmail"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          className={control}
        />
      </label>
      <label className="block text-sm">
        Handler name
        <input name="agentHandlerName" value={handlerName} onChange={(e) => setHandlerName(e.currentTarget.value)} className={control} />
      </label>
      <label className="block text-sm">
        Handler email
        <input
          name="agentHandlerEmail"
          type="email"
          value={handlerEmail}
          onChange={(e) => setHandlerEmail(e.currentTarget.value)}
          className={control}
        />
      </label>
      <label className="block text-sm">
        Handler telephone
        <input name="agentHandlerTel" value={handlerTel} onChange={(e) => setHandlerTel(e.currentTarget.value)} className={control} />
      </label>
      <label className="block text-sm">
        Reference
        <input name="agentReference" defaultValue={values.agentReference || ""} className={control} />
      </label>
    </div>
  );
}
