"use client";

import type { ChangeEvent, FocusEvent } from "react";
import { formatTypedValue, formatTypedValueLive, kindForField } from "@/lib/text";

type FieldEl = HTMLInputElement | HTMLTextAreaElement;

export function casingInputProps(name: string, type?: string, className = "") {
  const kind = kindForField(name, type);
  const extras = kind === "registration" || kind === "postcode" ? " uppercase" : "";
  return {
    autoCapitalize: kind === "registration" || kind === "postcode" ? ("characters" as const) : ("words" as const),
    className: `${className}${extras}`,
    onChange: (event: ChangeEvent<FieldEl>) => {
      if (kind === "plain") return;
      const el = event.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = formatTypedValueLive(name, el.value, type);
      if (next === el.value) return;
      el.value = next;
      if (start != null && end != null) el.setSelectionRange(start, end);
    },
    onBlur: (event: FocusEvent<FieldEl>) => {
      if (kind === "plain") return;
      event.currentTarget.value = formatTypedValue(name, event.currentTarget.value, type);
    },
  };
}
