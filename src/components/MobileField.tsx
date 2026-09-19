"use client";

import { useState } from "react";
import { clipMobileNumber, mobileDigits, MOBILE_REQUIRED_DIGITS, mobileNumberError } from "@/lib/phone-number";

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
        value={value}
        className={error ? `${className} field-invalid` : className}
        aria-invalid={error ? true : undefined}
        onChange={(event) => setValue(mobileDigits(event.currentTarget.value))}
      />
      <span className="mt-1 block text-xs text-slate">{MOBILE_REQUIRED_DIGITS} digits</span>
      {error ? (
        <span className="field-error" data-field-error={name}>
          {error}
        </span>
      ) : null}
    </>
  );
}
