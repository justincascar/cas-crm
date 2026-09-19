import { accidentDateError } from "./dates";
import { dobKindForField, dobSaveError, isDobFieldName, type DobKind } from "./age";
import { isMobileFieldName, mobileNumberError } from "./phone-number";

export const FIELD_INVALID_CLASS = "field-invalid";
export const FIELD_ERROR_CLASS = "field-error";

export type FieldError = { field: string; message: string };

export class FieldValidationError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "FieldValidationError";
    this.field = field;
  }
}

export type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export type ConstraintField = {
  name?: string;
  value: string;
  required?: boolean;
  type?: string;
  minLength?: number;
  maxLength?: number;
  min?: string;
  max?: string;
  pattern?: string;
  title?: string;
};

const SKIP_INPUT_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);

export function isFormControl(el: EventTarget | null): el is FormControl {
  return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
}

export function constraintMessage(field: ConstraintField): string | null {
  const value = field.value.trim();
  if (field.required && !value) return "This field is required.";
  if (field.type === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return "Enter a valid email address.";
  }
  if (field.minLength && field.minLength > 0 && value.length < field.minLength) {
    return `Enter at least ${field.minLength} characters.`;
  }
  if (field.maxLength && field.maxLength > 0 && value.length > field.maxLength) {
    return `Enter at most ${field.maxLength} characters.`;
  }
  if (field.pattern && value) {
    try {
      if (!new RegExp(`^(?:${field.pattern})$`).test(value)) {
        return field.title || "Enter a valid value.";
      }
    } catch {
      return field.title || "Enter a valid value.";
    }
  }
  return null;
}

export function namedFieldError(
  name: string,
  value: string,
  options?: { dobKind?: DobKind; dobConfirmed?: boolean },
): string | null {
  if (isMobileFieldName(name)) return mobileNumberError(value);
  if (name === "accidentDate" || name === "accident_date") return accidentDateError(value);
  if (isDobFieldName(name)) {
    return dobSaveError(value, options?.dobKind || dobKindForField("", name), Boolean(options?.dobConfirmed));
  }
  return null;
}

export function nativeValidityMessage(el: FormControl): string {
  const validity = "validity" in el ? el.validity : undefined;
  if (validity?.valueMissing) return "This field is required.";
  if (validity?.typeMismatch && "type" in el && el.type === "email") return "Enter a valid email address.";
  if (validity?.typeMismatch) return "Enter a valid value.";
  if (validity?.tooShort && "minLength" in el) return `Enter at least ${el.minLength} characters.`;
  if (validity?.tooLong && "maxLength" in el) return `Enter at most ${el.maxLength} characters.`;
  if (validity?.rangeUnderflow && "min" in el) return `Enter ${el.min} or more.`;
  if (validity?.rangeOverflow && "max" in el) return `Enter ${el.max} or less.`;
  if (validity?.stepMismatch) return "Enter a valid number.";
  if (validity?.patternMismatch) return el.title || "Enter a valid value.";
  if (validity?.badInput) return "Enter a valid value.";
  return el.validationMessage || "Check this field.";
}

export function firstFieldError(errors: FieldError[]): FieldError | undefined {
  return errors[0];
}

export function errorQuery(message: string, field?: string): string {
  const params = new URLSearchParams();
  params.set("error", message);
  if (field) params.set("field", field);
  return `?${params.toString()}`;
}

function shouldSkip(el: FormControl): boolean {
  if (el.disabled) return true;
  if (!el.name) return true;
  if (el instanceof HTMLInputElement && SKIP_INPUT_TYPES.has(el.type)) return true;
  return false;
}

function confirmChecked(form: HTMLFormElement, fieldName: string): boolean {
  const el = form.elements.namedItem(`${fieldName}_confirmed`);
  return el instanceof HTMLInputElement && el.checked;
}

function dobKindFromControl(el: FormControl): DobKind {
  const kind = el.dataset.dobKind;
  if (kind === "driver" || kind === "client" || kind === "owner" || kind === "hirer") return kind;
  return dobKindForField("", el.name);
}

export function customErrorForControl(el: FormControl, form: HTMLFormElement): string | null {
  return namedFieldError(el.name, el.value, {
    dobKind: dobKindFromControl(el),
    dobConfirmed: confirmChecked(form, el.name),
  });
}

export function relatedControl(el: FormControl, form: HTMLFormElement): FormControl {
  if (!el.name.endsWith("_confirmed")) return el;
  const dobName = el.name.slice(0, -"_confirmed".length);
  const dob = form.elements.namedItem(dobName);
  return isFormControl(dob) ? dob : el;
}

function radioGroupInvalid(form: HTMLFormElement, name: string): FormControl | null {
  const named = form.elements.namedItem(name);
  const radios: HTMLInputElement[] = [];
  if (named instanceof RadioNodeList) {
    for (const node of Array.from(named)) {
      if (node instanceof HTMLInputElement && node.type === "radio") radios.push(node);
    }
  } else if (named instanceof HTMLInputElement && named.type === "radio") {
    radios.push(named);
  }
  if (radios.length === 0) return null;
  const required = radios.some((radio) => radio.required);
  const checked = radios.some((radio) => radio.checked);
  if (required && !checked) return radios[0];
  return null;
}

export function collectInvalidControls(form: HTMLFormElement): { control: FormControl; message: string }[] {
  const seenRadios = new Set<string>();
  const result: { control: FormControl; message: string }[] = [];
  for (const el of Array.from(form.elements)) {
    if (!isFormControl(el) || shouldSkip(el)) continue;
    if (el instanceof HTMLInputElement && el.type === "radio") {
      if (seenRadios.has(el.name)) continue;
      seenRadios.add(el.name);
      const first = radioGroupInvalid(form, el.name);
      if (first) result.push({ control: first, message: "This field is required." });
      continue;
    }
    const custom = customErrorForControl(el, form);
    el.setCustomValidity(custom || "");
    if (el.validity.valid) continue;
    result.push({ control: el, message: custom || nativeValidityMessage(el) });
  }
  return result;
}

function errorSelector(name: string): string {
  return `[data-field-error="${name.replace(/"/g, "")}"]`;
}

export function findFieldErrorNode(control: FormControl): HTMLElement | null {
  const host = control.closest("label, fieldset, div") || control.parentElement;
  const scoped = host?.querySelector(errorSelector(control.name));
  if (scoped instanceof HTMLElement) return scoped;
  const form = control.form;
  const inForm = form?.querySelector(errorSelector(control.name));
  return inForm instanceof HTMLElement ? inForm : null;
}

export function applyInvalidFields(items: { control: FormControl; message: string }[]) {
  for (const { control, message } of items) {
    control.classList.add(FIELD_INVALID_CLASS);
    control.setAttribute("aria-invalid", "true");
    let node = findFieldErrorNode(control);
    if (!node) {
      node = document.createElement("p");
      node.className = FIELD_ERROR_CLASS;
      node.dataset.fieldError = control.name;
      control.insertAdjacentElement("afterend", node);
    }
    node.hidden = false;
    node.textContent = message;
    if (node.id) control.setAttribute("aria-describedby", node.id);
  }
}

export function clearFieldInvalid(control: FormControl) {
  control.classList.remove(FIELD_INVALID_CLASS);
  control.removeAttribute("aria-invalid");
  control.removeAttribute("aria-describedby");
  if ("setCustomValidity" in control) control.setCustomValidity("");
  const node = findFieldErrorNode(control);
  if (node) {
    node.textContent = "";
    node.hidden = true;
  }
}

function fieldIsInView(control: HTMLElement): boolean {
  const rect = control.getBoundingClientRect();
  const header = 96;
  return rect.top >= header && rect.bottom <= window.innerHeight - 16 && rect.width > 0 && rect.height > 0;
}

export function scrollAndFocusFirstInvalid(control: HTMLElement) {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const behavior: ScrollBehavior = reduceMotion ? "auto" : "smooth";
  control.scrollIntoView({ behavior, block: "center", inline: "nearest" });

  const bringIntoView = () => {
    if (typeof control.focus === "function") {
      control.focus({ preventScroll: true });
    }
    if (fieldIsInView(control)) return;
    const rect = control.getBoundingClientRect();
    const header = 96;
    const y = window.scrollY + rect.top - Math.max(header, window.innerHeight / 2 - rect.height / 2);
    window.scrollTo({ top: Math.max(0, y), behavior });
  };

  requestAnimationFrame(bringIntoView);
  window.setTimeout(bringIntoView, reduceMotion ? 0 : 80);
  window.setTimeout(bringIntoView, reduceMotion ? 0 : 400);
}

export function namedControl(form: HTMLFormElement, name: string): FormControl | null {
  const el = form.elements.namedItem(name);
  return isFormControl(el) ? el : null;
}

export function applyServerFieldError(form: HTMLFormElement, field: string, message: string) {
  const control = namedControl(form, field);
  if (!control) return null;
  applyInvalidFields([{ control, message }]);
  return control;
}
