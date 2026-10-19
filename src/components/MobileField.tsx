"use client";

import { useState } from "react";
import { isMobileFieldName, phoneFieldError, saveAnywayFieldName } from "@/lib/phone-number";

const fieldClass = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export function MobileField({
  name,
  defaultValue = "",
  value,
  onChange,
  className = fieldClass,
}: {
  name: string;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  className?: string;
}) {
  const [inner, setInner] = useState(defaultValue);
  const shown = value ?? inner;
  const error = phoneFieldError(name, shown);
  const mobile = isMobileFieldName(name);
  return (
    <>
      <input
        name={name}
        type="tel"
        autoComplete="tel"
        value={shown}
        className={error ? `${className} field-invalid` : className}
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (onChange) onChange(next);
          else setInner(next);
        }}
      />
      <span className="mt-1 block text-xs text-slate">
        {mobile ? "A UK mobile starts 07 or +447." : "A UK number starts 0 or +44."}
      </span>
      {error ? (
        <span className="field-error" data-field-error={name}>
          {error}
          <label className="mt-1 flex items-center gap-2 text-sm text-ink">
            <input name={saveAnywayFieldName(name)} type="checkbox" value="yes" />
            Save anyway
          </label>
        </span>
      ) : null}
    </>
  );
}
