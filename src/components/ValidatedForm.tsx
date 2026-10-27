"use client";

import { useEffect, useRef, useState, type FormEvent, type FormHTMLAttributes } from "react";
import {
  applyInvalidFields,
  applyServerFieldError,
  clearFieldInvalid,
  collectInvalidControls,
  customErrorForControl,
  fieldPlaceLabel,
  isFormControl,
  nativeValidityMessage,
  relatedControl,
  scrollAndFocusFirstInvalid,
  type FormControl,
} from "@/lib/form-validation";

type ServerFormAction = (formData: FormData) => void | Promise<unknown>;

type ValidatedFormProps = Omit<FormHTMLAttributes<HTMLFormElement>, "action"> & {
  initialError?: string;
  initialErrorField?: string;
  action?: string | ServerFormAction;
};

type NativeSubmit = NonNullable<FormHTMLAttributes<HTMLFormElement>["onSubmit"]>;
type NativeSubmitEvent = NativeSubmit extends (event: infer Event) => unknown ? Event : never;

export function ValidatedForm({
  children,
  initialError,
  initialErrorField,
  onSubmit,
  onInput,
  onChange,
  noValidate = true,
  action,
  method,
  encType,
  ...rest
}: ValidatedFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [refusals, setRefusals] = useState<string[]>([]);

  useEffect(() => {
    const form = formRef.current;
    if (!form || !initialErrorField) return;
    const control = applyServerFieldError(form, initialErrorField, initialError || "Check this field.");
    if (control) scrollAndFocusFirstInvalid(control);
  }, [initialError, initialErrorField]);

  function refusalLines(items: { control: FormControl; message: string }[]) {
    return items.map(({ control, message }) => `${fieldPlaceLabel(control)}: ${message}`);
  }

  function revalidate(event: FormEvent<HTMLFormElement>) {
    const target = event.target;
    if (!isFormControl(target) || !target.form) return;
    const control = relatedControl(target, target.form);
    const custom = customErrorForControl(control, target.form);
    control.setCustomValidity(custom || "");
    if (control.validity.valid) {
      clearFieldInvalid(control);
    } else if (control.classList.contains("field-invalid") || control.getAttribute("aria-invalid") === "true") {
      applyInvalidFields([{ control, message: custom || nativeValidityMessage(control) }]);
    }
    if (refusals.length) {
      const invalid = collectInvalidControls(target.form);
      setRefusals(invalid.length ? refusalLines(invalid) : []);
    }
  }

  function handleSubmit(event: NativeSubmitEvent) {
    const invalid = collectInvalidControls(event.currentTarget);
    if (invalid.length) {
      event.preventDefault();
      applyInvalidFields(invalid);
      setRefusals(refusalLines(invalid));
      scrollAndFocusFirstInvalid(invalid[0].control);
      return;
    }
    setRefusals([]);
    onSubmit?.(event);
  }

  // A server action is a function. React then sets method and encoding itself, and warns if we set them too.
  const functionAction = typeof action === "function";
  const formAction = functionAction ? (action as (formData: FormData) => void | Promise<void>) : action;
  return (
    <form
      {...rest}
      action={formAction}
      {...(functionAction ? {} : { method, encType })}
      ref={(node) => {
        formRef.current = node;
      }}
      noValidate={noValidate}
      onSubmit={handleSubmit}
      onInput={(event) => {
        revalidate(event);
        onInput?.(event);
      }}
      onChange={(event) => {
        revalidate(event);
        onChange?.(event);
      }}
    >
      {refusals.length ? (
        <div
          role="alert"
          data-form-error
          className="sticky top-20 z-20 rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue sm:col-span-2"
        >
          <p className="font-semibold">This was not saved.</p>
          <ul className="mt-1 list-disc pl-5">
            {refusals.map((line, index) => (
              <li key={`${index}-${line}`}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {children}
    </form>
  );
}
