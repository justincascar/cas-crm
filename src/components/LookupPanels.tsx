"use client";

import { useState } from "react";
import { actionLookupVehicle } from "@/app/actions";
import { PostcodeAddressLookup } from "@/components/PostcodeAddressLookup";
import { VEHICLE_MANUAL_HINT } from "@/lib/lookups/vehicle";

export function LookupPanels() {
  const [postcode, setPostcode] = useState("");
  const [address, setAddress] = useState("");
  const [town, setTown] = useState("");
  const [reg, setReg] = useState("");
  const [vehicle, setVehicle] = useState<string>("");

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-dashed border-copper/50 bg-[#fbf6ec] p-4">
        <p className="text-xs uppercase tracking-[0.12em] text-copper">Free postcode lookup</p>
        <div className="mt-2">
          <PostcodeAddressLookup
            postcodeName="lookup_postcode"
            addressName="lookup_address"
            townName="lookup_town"
            postcode={postcode}
            address={address}
            town={town}
            onPostcode={setPostcode}
            onAddress={setAddress}
            onTown={setTown}
          />
        </div>
        <p className="mt-2 text-xs text-slate">
          Uses postcodes.io and OpenStreetMap. Not Royal Mail. Manual entry always remains available.
        </p>
      </div>
      <div className="rounded-xl border border-dashed border-copper/50 bg-[#fbf6ec] p-4">
        <p className="text-xs uppercase tracking-[0.12em] text-copper">Registration lookup (manual fallback)</p>
        <div className="mt-2 flex gap-2">
          <input
            value={reg}
            onChange={(e) => setReg(e.target.value.toUpperCase())}
            placeholder="e.g. CF64 DLE"
            className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm uppercase"
          />
          <button
            type="button"
            className="rounded-md border border-line px-3 py-2 text-sm"
            onClick={async () => {
              try {
                const res = await actionLookupVehicle(reg);
                if (!res.result) {
                  setVehicle(VEHICLE_MANUAL_HINT);
                  return;
                }
                const v = res.result;
                const summary = [v.make, v.model, v.fuel, v.colour].filter(Boolean).join(" ") || "No make/colour returned";
                setVehicle(`${summary}. ${v.warnings.join(" ") || VEHICLE_MANUAL_HINT}`);
              } catch {
                setVehicle(VEHICLE_MANUAL_HINT);
              }
            }}
          >
            Look up
          </button>
        </div>
        <p className="mt-2 text-xs text-slate">{VEHICLE_MANUAL_HINT}</p>
        {vehicle ? <p className="mt-3 text-sm">{vehicle}</p> : null}
      </div>
    </div>
  );
}
