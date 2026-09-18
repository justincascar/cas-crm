"use client";

import { useState } from "react";
import { clipMobileNumber, MOBILE_REQUIRED_DIGITS, mobileNumberError } from "@/lib/phone-number";

const fieldClass = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export function MobileField({
  name,
  defaultValue = "",
  className = fieldClass,
}: {
  name: string;
  defaultValue?: string;
  className?: string;
}) {
  const [value, setValue] = useState(clipMobileNumber(defaultValue));
  const error = mobileNumberError(value);
  return (
    <>
      <input
        name={name}
        type="tel"
        inputMode="numeric"
        autoComplete="tel"
        maxLength={MOBILE_REQUIRED_DIGITS}
        value={value}
        className={className}
        onChange={(event) => setValue(clipMobileNumber(event.currentTarget.value))}
      />
      <span className="mt-1 block text-xs text-slate">{MOBILE_REQUIRED_DIGITS} digits</span>
      {error ? <span className="mt-1 block text-xs text-overdue">{error}</span> : null}
    </>
  );
}
