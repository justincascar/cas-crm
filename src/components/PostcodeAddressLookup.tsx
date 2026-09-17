"use client";

import { useId, useRef, useState } from "react";
import { actionLookupPostcode } from "@/app/actions";
import { formatPostcode, formatPostcodeLive, isCompleteUkPostcode, toStartCase, toStartCaseLive } from "@/lib/text";

export type PickedAddress = { line1: string; town: string; postcode: string };

const control = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export function PostcodeAddressLookup({
  postcodeName,
  addressName,
  townName,
  postcode,
  address,
  town,
  onPostcode,
  onAddress,
  onTown,
  onPicked,
  showAddressFields = true,
  showTownField = true,
}: {
  postcodeName: string;
  addressName: string;
  townName: string;
  postcode: string;
  address: string;
  town: string;
  onPostcode: (value: string) => void;
  onAddress: (value: string) => void;
  onTown: (value: string) => void;
  onPicked?: (picked: PickedAddress) => void;
  showAddressFields?: boolean;
  showTownField?: boolean;
}) {
  const postcodeId = useId();
  const selectId = useId();
  const addressRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const [options, setOptions] = useState<PickedAddress[]>([]);
  const [selected, setSelected] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [looking, setLooking] = useState(false);

  async function findAddresses(raw: string) {
    const query = formatPostcode(raw);
    if (!isCompleteUkPostcode(query)) {
      setMsg("Enter a full UK postcode, then choose the address from the list.");
      setFailed(true);
      setOptions([]);
      return;
    }
    const id = ++requestId.current;
    setLooking(true);
    setMsg("Finding addresses…");
    setFailed(false);
    setSelected("");
    try {
      const res = await actionLookupPostcode(query);
      if (id !== requestId.current) return;
      if (res.formattedPostcode) onPostcode(formatPostcode(res.formattedPostcode));
      if (res.town) onTown(toStartCase(res.town));
      setOptions(res.results);
      if (res.error) {
        setFailed(true);
        setMsg(res.error);
        return;
      }
      if (res.results.length === 0) {
        setFailed(true);
        setMsg(res.warning || "Postcode found. Type the house number and street.");
        addressRef.current?.focus();
        return;
      }
      setFailed(false);
      const pafNote = res.licensedPaf
        ? ""
        : " This is the free map list, not Royal Mail, so houses may be missing or wrong.";
      if (res.results.length === 1) {
        applyPicked(res.results[0], "0");
        setMsg("One address found and filled in. Change it from the list if needed." + pafNote);
        return;
      }
      setMsg("Select the address from the list." + pafNote);
    } catch {
      if (id !== requestId.current) return;
      setFailed(true);
      setOptions([]);
      setMsg("The address list did not come back. Type the street and number.");
      addressRef.current?.focus();
    } finally {
      if (id === requestId.current) setLooking(false);
    }
  }

  function applyPicked(picked: PickedAddress, index: string) {
    setSelected(index);
    const line1 = toStartCase(picked.line1);
    const pickedTown = toStartCase(picked.town);
    onPostcode(formatPostcode(picked.postcode));
    onTown(pickedTown);
    onAddress(showTownField ? line1 : [line1, pickedTown].filter(Boolean).join(", "));
    onPicked?.({ line1, town: pickedTown, postcode: formatPostcode(picked.postcode) });
  }

  function applyAddress(index: string) {
    const picked = options[Number(index)];
    if (!picked) {
      setSelected("");
      return;
    }
    applyPicked(picked, index);
  }

  return (
    <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="block text-sm" htmlFor={postcodeId}>
          Postcode
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id={postcodeId}
            name={postcodeName}
            value={postcode}
            autoComplete="postal-code"
            className={control + " !mt-0 uppercase"}
            onChange={(e) => {
              onPostcode(formatPostcodeLive(e.target.value));
              setSelected("");
              setOptions([]);
              setMsg(null);
            }}
            onBlur={() => onPostcode(formatPostcode(postcode))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void findAddresses(postcode);
              }
            }}
          />
          <button
            type="button"
            className="rounded-md border border-line bg-white px-3 py-2 text-sm whitespace-nowrap"
            disabled={looking}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void findAddresses(postcode)}
          >
            {looking ? "Finding…" : "Find address"}
          </button>
        </div>
      </div>

      <div className="sm:col-span-2">
        <label className="block text-sm" htmlFor={selectId}>
          Select address
        </label>
        {options.length > 0 ? (
          <select
            id={selectId}
            className={control}
            value={selected}
            size={Math.min(8, options.length + 1)}
            onChange={(e) => applyAddress(e.target.value)}
          >
            <option value="">{`${options.length} addresses found — select one`}</option>
            {options.map((a, index) => (
              <option key={`${a.line1}-${a.postcode}-${index}`} value={String(index)}>
                {a.line1}, {a.town}, {a.postcode}
              </option>
            ))}
          </select>
        ) : (
          <select id={selectId} className={control} disabled value="">
            <option value="">{looking ? "Finding addresses…" : "Enter the postcode, then find address"}</option>
          </select>
        )}
        {msg ? (
          <p className={`mt-1 text-sm ${failed ? "rounded-md border border-warn/40 bg-[#fff6e8] px-3 py-2 text-ink" : "text-slate"}`}>
            {msg}
          </p>
        ) : null}
      </div>

      {showAddressFields ? (
        <>
          <label className="block text-sm sm:col-span-2">
            Address
            <input
              ref={addressRef}
              name={addressName}
              value={address}
              className={control}
              onChange={(e) => onAddress(toStartCaseLive(e.target.value))}
              onBlur={() => onAddress(toStartCase(address))}
            />
          </label>
          {showTownField ? (
            <label className="block text-sm">
              Town
              <input
                name={townName}
                value={town}
                className={control}
                onChange={(e) => onTown(toStartCaseLive(e.target.value))}
                onBlur={() => onTown(toStartCase(town))}
              />
            </label>
          ) : (
            <input type="hidden" name={townName} value={town} />
          )}
        </>
      ) : null}
    </div>
  );
}
