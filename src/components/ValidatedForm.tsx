"use client";

import { useEffect, useRef, type FormEvent, type FormHTMLAttributes } from "react";
import {
  applyInvalidFields,
  applyServerFieldError,
  clearFieldInvalid,
  collectInvalidControls,
  customErrorForControl,
  isFormControl,
  nativeValidityMessage,
  relatedControl,
  scrollAndFocusFirstInvalid,
} from "@/lib/form-validation";

type ValidatedFormProps = FormHTMLAttributes<HTMLFormElement> & {
  initialError?: string;
  initialErrorField?: string;
};

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

  useEffect(() => {
    const form = formRef.current;
    if (!form || !initialErrorField) return;
    const control = applyServerFieldError(form, initialErrorField, initialError || "Check this field.");
    if (control) scrollAndFocusFirstInvalid(control);
  }, [initialError, initialErrorField]);

  function revalidate(event: FormEvent<HTMLFormElement>) {
    const target = event.target;
    if (!isFormControl(target) || !target.form) return;
    const control = relatedControl(target, target.form);
    const custom = customErrorForControl(control, target.form);
    control.setCustomValidity(custom || "");
    if (control.validity.valid) {
      clearFieldInvalid(control);
      return;
    }
    if (control.classList.contains("field-invalid") || control.getAttribute("aria-invalid") === "true") {
      applyInvalidFields([{ control, message: custom || nativeValidityMessage(control) }]);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const invalid = collectInvalidControls(event.currentTarget);
    if (invalid.length) {
      event.preventDefault();
      applyInvalidFields(invalid);
      scrollAndFocusFirstInvalid(invalid[0].control);
      return;
    }
    onSubmit?.(event);
  }

  // A server action is a function. React then sets method and encoding itself, and warns if we set them too.
  const functionAction = typeof action === "function";
  return (
    <form
      {...rest}
      action={action}
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
      {children}
    </form>
  );
}
